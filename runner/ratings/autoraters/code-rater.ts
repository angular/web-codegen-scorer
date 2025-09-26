import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { prepareContextFilesMessage } from '../../orchestration/codegen.js';
import { Environment } from '../../configuration/environment.js';
import {
  IndividualAssessment,
  IndividualAssessmentState,
  LlmResponseFile,
  SkippedIndividualAssessment,
} from '../../shared-interfaces.js';
import {
  AutoRateResult,
  getCoefficient,
  MAX_RATING,
} from './auto-rate-shared.js';
import { GenkitRunner } from '../../codegen/genkit/genkit-runner.js';
import defaultCodeRaterPrompt from './code-rating-prompt.js';
import { RatingsResult } from '../rating-types.js';

/** Framework-specific hints for the rating prompt. */
const FW_HINTS: Record<string, string | undefined> = {
  angular: [
    '### Useful information',
    '',
    'If you see Angular code:',
    '- Assume Angular v20+',
    '- Remember `standalone: true` is the default already. No need to explicitly set this.',
  ].join('\n'),
};

/** Cache for prompt ratings that have been read from disk. */
const CACHED_RATING_PROMPTS: Record<string, string> = {};

/**
 * Automatically rates source code using an LLM.
 * @param llm LLM runner to use for the rating.
 * @param abortSignal Signal to fire when the rating should be aborted.
 * @param model Model to use for the rating.
 * @param environment Environment in which the rating is running.
 * @param files Files to be rated.
 * @param appPrompt Prompt to be used for the rating.
 * @param ratingsResult Context containing results from previous ratings.
 */
export async function autoRateCode(
  llm: GenkitRunner,
  abortSignal: AbortSignal,
  model: string,
  environment: Environment,
  files: LlmResponseFile[],
  appPrompt: string,
  ratingsResult: RatingsResult
): Promise<AutoRateResult> {
  const contextMessage = prepareContextFilesMessage(
    files.map((o) => ({
      relativePath: o.filePath,
      content: o.code,
    }))
  );

  let promptText: string;

  if (environment.codeRatingPromptPath) {
    CACHED_RATING_PROMPTS[environment.codeRatingPromptPath] ??= readFileSync(
      environment.codeRatingPromptPath,
      'utf8'
    );
    promptText = CACHED_RATING_PROMPTS[environment.codeRatingPromptPath];
  } else {
    promptText = defaultCodeRaterPrompt;
  }

  // At this point, we assume that safety-web checks have run.
  // The order in runner/ratings/built-in.ts has been set to ensure this.
  // (But it's entirely possible that a particular run has overridden a different order. )
  const safetyRating = ratingsResult['safety-web'];
  const safetyWebResultsJson =
    safetyRating?.state === IndividualAssessmentState.EXECUTED
      ? JSON.stringify(safetyRating, null, 2)
      : '';

  const prompt = environment.renderPrompt(
    promptText,
    environment.codeRatingPromptPath,
    {
      APP_PROMPT: appPrompt,
      FRAMEWORK_SPECIFIC_HINTS:
        FW_HINTS[environment.fullStackFramework.id] ?? '',
      SAFETY_WEB_RESULTS_JSON: safetyWebResultsJson,
    }
  ).result;

  const result = await llm.generateConstrained({
    abortSignal,
    messages: contextMessage ? [contextMessage] : [],
    model,
    prompt,
    skipMcp: true,
    schema: z.object({
      rating: z
        .number()
        .describe(`Rating from 1-${MAX_RATING}. Best is ${MAX_RATING}.`),
      summary: z.string().describe('Summary of the overall code quality.'),
      categories: z.array(
        z.object({
          name: z.string().describe('Category name'),
          message: z.string().describe('Short description of the problem.'),
        })
      ),
    }),
  });

  return {
    coefficient: getCoefficient(result.output!.rating),
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
    },
    details: result.output!,
  };
}
