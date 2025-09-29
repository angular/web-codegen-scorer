import PQueue from 'p-queue';
import {
  AttemptDetails,
  LlmContextFile,
  LlmResponse,
  LlmResponseFile,
  RootPromptDefinition,
} from '../shared-interfaces.js';
import { Environment } from '../configuration/environment.js';
import { repairCodeWithAI } from './codegen.js';
import { writeResponseFiles } from './file-system.js';
import { runBuild } from './build-worker.js';
import { ProgressLogger } from '../progress/progress-logger.js';
import { EvalID, Gateway } from './gateway.js';

/**
 * Calls the LLM to repair code, handles the response, and attempts to build the project again.
 *
 * @param evalID ID of the eval being executed.
 * @param gateway Gateway.
 * @param model The model name to use for the repair.
 * @param env The environment configuration.
 * @param directory The working directory.
 * @param finalOutputFiles The list of output files to be modified.
 * @param errorMessage The error message from the failed build.
 * @param errorContext Additional context for the error.
 * @param contextFiles A list of context files for the LLM.
 * @param abortSignal An AbortSignal to cancel the operation.
 * @param workerConcurrencyQueue The queue for managing worker concurrency.
 * @param attempts The current attempt number.
 * @param repairType The type of repair being performed.
 * @returns A promise that resolves to the new BuildResult.
 */
export async function repairAndBuild(
  evalID: EvalID,
  gateway: Gateway<Environment>,
  model: string,
  env: Environment,
  rootPromptDef: RootPromptDefinition,
  directory: string,
  finalOutputFiles: LlmResponseFile[],
  errorMessage: string,
  errorContext: string,
  contextFiles: LlmContextFile[],
  abortSignal: AbortSignal,
  workerConcurrencyQueue: PQueue,
  attempts: number,
  progress: ProgressLogger
): Promise<AttemptDetails> {
  const repairResponse = await repairCodeWithAI(
    evalID,
    gateway,
    model,
    env,
    rootPromptDef,
    directory,
    finalOutputFiles,
    errorMessage,
    errorContext,
    contextFiles,
    abortSignal,
    progress
  );

  return await handleRepairResponse(
    evalID,
    gateway,
    repairResponse,
    finalOutputFiles,
    env,
    rootPromptDef,
    directory,
    workerConcurrencyQueue,
    abortSignal,
    attempts,
    progress
  );
}

/**
 * Processes an LLM repair response by merging the suggested file changes,
 * writing them to disk, rebuilding the application, and logging the outcome.
 */
async function handleRepairResponse(
  evalID: EvalID,
  gateway: Gateway<Environment>,
  repairResponse: LlmResponse,
  finalOutputFiles: LlmResponseFile[],
  env: Environment,
  rootPromptDef: RootPromptDefinition,
  directory: string,
  workerConcurrencyQueue: PQueue,
  abortSignal: AbortSignal,
  attempts: number,
  progress: ProgressLogger
) {
  if (!repairResponse.success) {
    progress.log(
      rootPromptDef,
      'error',
      `AI failed to generate a response for repair attempt #${attempts + 1}`
    );

    // Stop trying to repair if AI can't suggest a fix (API request fails)
    throw new Error(
      `Repair request failed: ${repairResponse.errors.join('\n')}`
    );
  }
  mergeRepairFiles(repairResponse.outputFiles, finalOutputFiles);
  writeResponseFiles(directory, finalOutputFiles, env, rootPromptDef.name);

  const buildResult = await runBuild(
    evalID,
    gateway,
    directory,
    env,
    rootPromptDef,
    abortSignal,
    workerConcurrencyQueue,
    progress
  );

  return {
    // Log the `outputFiles` from the repair response specifically, because
    // we want a snapshot after the current API call, not the full file set.
    outputFiles: repairResponse.outputFiles,
    usage: repairResponse.usage,
    reasoning: repairResponse.reasoning,
    buildResult,
    serveTestingResult: null,
    attempt: attempts,
  };
}

/**
 * Merges a set of new or updated files from a repair attempt into the
 * current set of files.
 * @param repairOutputFiles The array of new or updated files to merge.
 * @param finalFiles The array of files to be updated.
 */
function mergeRepairFiles(
  repairOutputFiles: LlmResponseFile[],
  finalFiles: LlmResponseFile[]
) {
  // Merge the repair response into the original files. Otherwise we may end up dropping
  // files that were valid in the initial response and the LLM decided not to touch, because
  // they're still valid.
  for (const file of repairOutputFiles) {
    const existingFile = finalFiles.find((f) => f.filePath === file.filePath);

    if (existingFile) {
      existingFile.code = file.code;
    } else {
      finalFiles.push(file);
    }
  }
}
