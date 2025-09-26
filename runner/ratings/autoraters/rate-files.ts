import { greenCheckmark } from '../../reporting/format.js';
import {
  AutoraterRunInfo,
  IndividualAssessment,
  LlmResponseFile,
  SkippedIndividualAssessment,
} from '../../shared-interfaces.js';
import { autoRateCode } from './code-rater.js';
import { autoRateAppearance } from './visuals-rater.js';
import { Environment } from '../../configuration/environment.js';
import { GenkitRunner } from '../../codegen/genkit/genkit-runner.js';
import { RatingsResult } from '../rating-types.js';

/**
 * Automatically rates the code inside of a file.
 * @param llm LLM runner used to do the rating.
 * @param abortSignal Signal to fire when the auto-rating should be aborted.
 * @param model Model to use for the rating.
 * @param filePath Path to the file to be rated.
 * @param appPrompt Prompt that should be checked.
 * @param screenshotPath Path to the screenshot to use for visual rating.
 * @param ratingsResult Context containing results from previous ratings.
 */
export async function autoRateFiles(
  llm: GenkitRunner,
  abortSignal: AbortSignal,
  model: string,
  environment: Environment,
  files: LlmResponseFile[],
  appPrompt: string,
  screenshotPngUrl: string | null,
  ratingsResult: RatingsResult
): Promise<AutoraterRunInfo> {
  console.log(`Autorater is using '${model}' model. \n`);

  // Code scoring...
  console.log('⏳ Awaiting code scoring results...');
  const codeResult = await autoRateCode(
    llm,
    abortSignal,
    model,
    environment,
    files,
    appPrompt,
    ratingsResult
  );
  console.log(`${greenCheckmark()} Code scoring is successful.`);

  // Visual (screenshot) scoring...
  let visualRating = undefined;
  if (screenshotPngUrl) {
    console.log('⏳ Awaiting visual scoring results...');
    visualRating = await autoRateAppearance(
      llm,
      abortSignal,
      model,
      environment,
      appPrompt,
      screenshotPngUrl,
      'command-line'
    );
    console.log(`${greenCheckmark()} Visual scoring is successful.`);
  }

  return {
    codeRating: codeResult,
    visualRating,
    model,
  } satisfies AutoraterRunInfo;
}
