import { BuildResult } from '../workers/builder/builder-types.js';
import { extname } from 'path';
import {
  IndividualAssessment,
  CodeAssessmentScore,
  LlmResponseFile,
  SkippedIndividualAssessment,
  IndividualAssessmentState,
  PromptDefinition,
  AssessmentCategory,
} from '../shared-interfaces.js';
import {
  RatingState,
  LLMBasedRating,
  PerBuildRating,
  PerFileRating,
  PerFileRatingContentType,
  RatingKind,
  RatingCategory,
  POINTS_FOR_CATEGORIES,
  Rating,
  CATEGORY_NAMES,
  RatingsResult,
} from './rating-types.js';
import { extractEmbeddedCodeFromTypeScript } from './embedded-languages.js';
import { Environment } from '../configuration/environment.js';
import { GenkitRunner } from '../codegen/genkit/genkit-runner.js';
import { ProgressLogger } from '../progress/progress-logger.js';
import { UserFacingError } from '../utils/errors.js';
import { ServeTestingResult } from '../workers/serve-testing/worker-types.js';

interface FileOrEmbeddedSyntheticFile {
  /**
   * Path of the file.
   *
   * Note that the `filePath` can point to a `.ts` path for
   * embedded code that was discovered in a TypeScript file.
   */
  filePath: string;
  /** Content of the file. */
  code: string;
}

type CategorizedFiles = Record<
  PerFileRatingContentType,
  FileOrEmbeddedSyntheticFile[]
>;

export async function rateGeneratedCode(
  llm: GenkitRunner,
  environment: Environment,
  currentPromptDef: PromptDefinition,
  fullPromptText: string,
  outputFiles: LlmResponseFile[],
  buildResult: BuildResult,
  serveTestingResult: ServeTestingResult | null,
  repairAttempts: number,
  axeRepairAttempts: number,
  abortSignal: AbortSignal,
  progress: ProgressLogger,
  autoraterModel: string
): Promise<CodeAssessmentScore> {
  let categorizedFiles: CategorizedFiles | null = null;
  let totalPoints = 0;
  let maxOverallPoints = 0;
  const ratingsResult: RatingsResult = {};

  // Rating may also invoke LLMs. Track the usage.
  const tokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  progress.log(currentPromptDef, 'eval', 'Rating generated code');

  const categories: AssessmentCategory[] = [
    RatingCategory.HIGH_IMPACT,
    RatingCategory.MEDIUM_IMPACT,
    RatingCategory.LOW_IMPACT,
  ].map((category) => ({
    id: category,
    name: CATEGORY_NAMES[category],
    points: 0,
    maxPoints: POINTS_FOR_CATEGORIES[category],
    assessments: [],
  }));

  for (const current of currentPromptDef.ratings) {
    let result: IndividualAssessment | SkippedIndividualAssessment;

    try {
      if (current.kind === RatingKind.PER_BUILD) {
        result = runPerBuildRating(
          current,
          buildResult,
          serveTestingResult,
          repairAttempts,
          outputFiles.length,
          axeRepairAttempts,
          ratingsResult
        );
      } else if (current.kind === RatingKind.PER_FILE) {
        categorizedFiles ??= splitFilesIntoCategories(outputFiles);
        result = await runPerFileRating(
          current,
          categorizedFiles,
          ratingsResult
        );
      } else if (current.kind === RatingKind.LLM_BASED) {
        result = await runLlmBasedRating(
          environment,
          current,
          fullPromptText,
          currentPromptDef,
          llm,
          outputFiles,
          buildResult,
          serveTestingResult,
          repairAttempts,
          axeRepairAttempts,
          abortSignal,
          autoraterModel,
          ratingsResult
        );
      } else {
        throw new UserFacingError(`Unsupported rating type ${current}`);
      }
    } catch (error) {
      result = getSkippedAssessment(
        current,
        `Error during execution:\n${error}`
      );
    }

    if (result.state === IndividualAssessmentState.EXECUTED && result.usage) {
      tokenUsage.inputTokens += result.usage.inputTokens;
      tokenUsage.outputTokens += result.usage.outputTokens;
      tokenUsage.totalTokens += result.usage.totalTokens ?? 0;
    }

    const category = categories.find((c) => c.id === result.category);

    if (!category) {
      throw new UserFacingError(
        `Could not find category for rating "${result.id}" with category "${result.category}"`
      );
    }

    ratingsResult[current.id] = result;
    category.assessments.push(result);
  }

  // Second pass to assign points to the categories once all the ratings have run.
  for (const category of categories) {
    let multiplier = 1;

    for (const result of category.assessments) {
      if (result.state === IndividualAssessmentState.EXECUTED) {
        const reduction =
          parsePercentString(result.scoreReduction) *
          (1 - result.successPercentage);
        multiplier = Math.max(0, multiplier - reduction);
      }
    }

    // Round the number to two decimals.
    // via: https://stackoverflow.com/questions/11832914/how-to-round-to-at-most-2-decimal-places-if-necessary
    category.points =
      Math.round((category.maxPoints * multiplier + Number.EPSILON) * 100) /
      100;
    maxOverallPoints += category.maxPoints;
    totalPoints += category.points;
  }

  return {
    totalPoints,
    maxOverallPoints,
    categories,
    tokenUsage,
  };
}

function runPerBuildRating(
  rating: PerBuildRating,
  buildResult: BuildResult,
  serveResult: ServeTestingResult | null,
  repairAttempts: number,
  generatedFileCount: number,
  axeRepairAttempts: number,
  ratingsResult: RatingsResult
): IndividualAssessment | SkippedIndividualAssessment {
  const rateResult = rating.rate({
    buildResult,
    serveResult,
    repairAttempts,
    generatedFileCount,
    axeRepairAttempts,
    ratingsResult,
  });

  // If the rating was skipped (e.g., Axe test wasn't run), create a skipped assessment.
  // This prevents it from affecting the score.
  if (rateResult.state === RatingState.SKIPPED) {
    return getSkippedAssessment(rating, rateResult.message);
  }

  const message =
    getMessage(rateResult.coefficient) +
    (rateResult.message ? `\n${rateResult.message}` : '');

  return getIndividualAssessment(rating, rateResult.coefficient, message);
}

async function runPerFileRating(
  rating: PerFileRating,
  categorizedFiles: CategorizedFiles,
  ratingsResult: RatingsResult
): Promise<IndividualAssessment | SkippedIndividualAssessment> {
  const errorMessages: string[] = [];
  let contentType: PerFileRatingContentType;
  let contentFilterPattern: RegExp | null;
  let pathFilterPattern: RegExp | null;

  if (typeof rating.filter === 'number') {
    contentType = rating.filter;
    contentFilterPattern = null;
    pathFilterPattern = null;
  } else {
    contentType = rating.filter.type;
    contentFilterPattern = rating.filter.pattern ?? null;
    pathFilterPattern = rating.filter.pathPattern ?? null;
  }

  const files = categorizedFiles[contentType];
  let filesExecuted = 0;
  let total = 0;

  for (const file of files) {
    const matchesFilePattern =
      contentFilterPattern === null || contentFilterPattern.test(file.code);
    const matchesPathPattern =
      pathFilterPattern === null || pathFilterPattern.test(file.filePath);

    if (matchesFilePattern && matchesPathPattern) {
      // Remove comments from the code to avoid false-detection of bad patterns.
      // Some keywords like `NgModule` can be used in code comments.
      const code = removeComments(file.code, contentType);
      const result = await rating.rate(code, file.filePath, ratingsResult);
      let coeff: number;

      if (typeof result === 'number') {
        coeff = result;
      } else {
        coeff = result.rating;
        errorMessages.push(result.errorMessage);
      }

      total += coeff;
      filesExecuted++;
    }
  }

  if (filesExecuted === 0) {
    return getSkippedAssessment(rating, 'Does not match any files');
  }

  const average = total / filesExecuted;
  let message = getMessage(average);

  if (errorMessages.length) {
    message += [
      '',
      'Errors:',
      errorMessages.join(`\n ${'-'.repeat(50)} \n`),
    ].join('\n');
  }

  return getIndividualAssessment(rating, average, message);
}

async function runLlmBasedRating(
  environment: Environment,
  rating: LLMBasedRating,
  fullPromptText: string,
  currentPromptDef: PromptDefinition,
  llm: GenkitRunner,
  outputFiles: LlmResponseFile[],
  buildResult: BuildResult,
  serveTestingResult: ServeTestingResult | null,
  repairAttempts: number,
  axeRepairAttempts: number,
  abortSignal: AbortSignal,
  autoraterModel: string,
  ratingsResult: RatingsResult
): Promise<IndividualAssessment | SkippedIndividualAssessment> {
  const result = await rating.rate({
    environment,
    fullPromptText,
    currentPromptDef,
    llm,
    model: autoraterModel,
    outputFiles,
    buildResult,
    serveTestingResult,
    repairAttempts,
    axeRepairAttempts,
    abortSignal,
    ratingsResult,
  });

  if (result.state === RatingState.SKIPPED) {
    return getSkippedAssessment(rating, result.message);
  }

  let message = `${getMessage(result.coefficient)}\n${result.details.summary}`;

  if (result.coefficient < 1) {
    message +=
      ':\n' +
      result.details.categories
        .map((category) => category.message)
        .join('\n  ');
  }

  return getIndividualAssessment(rating, result.coefficient, message);
}

function getIndividualAssessment(
  rating: Rating,
  rateResult: number,
  message: string
): IndividualAssessment {
  return {
    state: IndividualAssessmentState.EXECUTED,
    name: rating.name,
    description: rating.description,
    id: rating.id,
    scoreReduction: rating.scoreReduction,
    successPercentage: rateResult,
    category: rating.category,
    message,
  };
}

function getSkippedAssessment(
  rating: Rating,
  message: string
): SkippedIndividualAssessment {
  return {
    state: IndividualAssessmentState.SKIPPED,
    name: rating.name,
    description: rating.description,
    id: rating.id,
    category: rating.category,
    message,
  };
}

function removeComments(code: string, contentType: PerFileRatingContentType) {
  if (contentType === PerFileRatingContentType.HTML) {
    return code.replace(/<!--[\s\S]*?-->/gm, '');
  }

  if (contentType === PerFileRatingContentType.CSS) {
    return code.replace(/\/\*[\s\S]*?\*\//gm, '');
  }

  if (contentType === PerFileRatingContentType.TS) {
    return code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$|<!--[\s\S]*?-->/gm, '');
  }

  return code;
}

function getMessage(coefficient: number) {
  if (coefficient === 1) {
    return 'Pass';
  }

  if (coefficient === 0) {
    return 'Fail';
  }

  return `Partial Pass (${Math.round(coefficient * 100)}%)`;
}

function splitFilesIntoCategories(
  outputFiles: LlmResponseFile[]
): CategorizedFiles {
  const ts: FileOrEmbeddedSyntheticFile[] = [];
  const css: FileOrEmbeddedSyntheticFile[] = [];
  const html: FileOrEmbeddedSyntheticFile[] = [];
  const all: FileOrEmbeddedSyntheticFile[] = [];

  for (const file of outputFiles) {
    const extension = extname(file.filePath).toLowerCase();

    // `UNKNOWN` captures all files.
    all.push(file);

    if (extension === '.ts' || extension === '.tsx') {
      const embedded =
        extension === '.ts' ? extractEmbeddedCodeFromTypeScript(file) : null;

      if (embedded !== null) {
        css.push(...embedded.stylesheets);
        html.push(...embedded.templates);
      }

      ts.push(file);
    } else if (extension === '.css' || extension === '.scss') {
      css.push(file);
    } else if (extension === '.html') {
      html.push(file);
    }
  }

  return {
    [PerFileRatingContentType.TS]: ts,
    [PerFileRatingContentType.CSS]: css,
    [PerFileRatingContentType.HTML]: html,
    [PerFileRatingContentType.UNKNOWN]: all,
  };
}

function parsePercentString(value: string): number {
  let parsed: number | null = null;

  if (value.endsWith('%')) {
    parsed = parseFloat(value.slice(0, -1));
  }

  if (parsed === null || isNaN(parsed)) {
    throw new UserFacingError(`Value '${value}' is not a valid percentage`);
  }

  return parsed / 100;
}
