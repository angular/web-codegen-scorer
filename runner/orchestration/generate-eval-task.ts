import PQueue from 'p-queue';
import {GenkitRunner} from '../codegen/genkit/genkit-runner.js';
import {Environment} from '../configuration/environment.js';
import {
  AssessmentConfig,
  AssessmentResult,
  AttemptDetails,
  MultiStepPromptDefinition,
  PromptDefinition,
} from '../shared-interfaces.js';
import {EvalID} from './executors/executor.js';
import {ProgressLogger} from '../progress/progress-logger.js';
import {resolveContextFiles, setupProjectStructure, writeResponseFiles} from './file-system.js';
import {generateInitialFiles} from './generate-initial-files.js';
import {generateUserJourneysForApp} from './user-journeys.js';
import {BrowserAgentTaskInput} from '../testing/browser-agent/models.js';
import {attemptBuildAndTest} from './build-serve-test-loop.js';
import {rateGeneratedCode} from '../ratings/rate-code.js';
import {DEFAULT_AUTORATER_MODEL_NAME} from '../configuration/constants.js';

/**
 * Creates and executes a task to generate or load code for a given prompt,
 * attempt to build it, repair it if necessary, and assess its quality.
 *
 * This function handles both online (AI-generated) and local (file-based) code retrieval.
 * It manages build attempts and AI-driven repair cycles.
 *
 * @param evalID ID of the evaluation task.
 * @param env Environment for this evaluation.
 * @param model Name of the LLM to use.
 * @param rootPromptDef Definition of the root prompt being processed.
 * @param localMode A boolean indicating whether to load code from local files instead of generating it.
 * @param skipScreenshots Whether to skip taking screenshot of a running application.
 * @param outputDirectory Directory in which to generate the output. Convenient for debugging.
 * @param abortSignal Abort signal for when the evaluation task should be aborted.
 * @param skipAxeTesting Whether or not to skip Axe testing of the app.
 * @param enableUserJourneyTesting Whether to enable user journey testing of generated apps.
 * @param workerConcurrencyQueue Concurrency queue for controlling parallelism of worker invocations (as they are more expensive than LLM calls).
 * @returns A Promise that resolves to an AssessmentResult object containing all details of the task's execution.
 */
export async function startEvaluationTask(
  config: AssessmentConfig,
  evalID: EvalID,
  env: Environment,
  ratingLlm: GenkitRunner,
  rootPromptDef: PromptDefinition | MultiStepPromptDefinition,
  abortSignal: AbortSignal,
  workerConcurrencyQueue: PQueue,
  progress: ProgressLogger,
): Promise<AssessmentResult[]> {
  // Set up the project structure once for the root project.
  const {directory, cleanup} = await setupProjectStructure(
    env,
    rootPromptDef,
    progress,
    config.outputDirectory,
  );

  const results: AssessmentResult[] = [];
  const defsToExecute = rootPromptDef.kind === 'single' ? [rootPromptDef] : rootPromptDef.steps;

  for (const promptDef of defsToExecute) {
    const [fullPromptText, systemInstructions] = await Promise.all([
      env.getPrompt(promptDef.systemPromptType, promptDef.prompt, config.ragEndpoint),
      env.getPrompt(promptDef.systemPromptType, ''),
    ]);

    // Resolve the context files from the root. We need to do this after the project is set up
    // and for each sub-prompt, because the project will be augmented on each iteration.
    const contextFiles = await resolveContextFiles(promptDef.contextFilePatterns, directory);

    // Generate the initial set of files through the LLM.
    const initialResponse = await generateInitialFiles(
      config,
      evalID,
      env,
      promptDef,
      {
        directory,
        systemInstructions,
        combinedPrompt: fullPromptText,
        executablePrompt: promptDef.prompt,
      },
      contextFiles,
      abortSignal,
      progress,
    );

    const toolLogs = initialResponse.toolLogs ?? [];

    if (!initialResponse) {
      progress.log(
        promptDef,
        'error',
        'Failed to generate initial code using AI. Skipping this app.',
      );
      await cleanup();
      break;
    }

    try {
      // Write the generated files to disk.
      // Note: This can fail when the LLM e.g. produced a wrong file name that is too large,
      // and results in a file system error. Gracefully handle this so we can continue testing.
      // Write the generated files to disk within the project directory.
      await writeResponseFiles(directory, initialResponse.files, env, rootPromptDef.name);

      // If we're in a multi-step prompt, also write out to dedicated directories
      // for each sub-prompt so that we can inspect the output along the way.
      if (rootPromptDef.kind === 'multi-step') {
        await writeResponseFiles(directory, initialResponse.files, env, promptDef.name);
      }
    } catch (e) {
      let details = `Error: ${e}`;

      if ((e as Partial<Error>).stack) {
        details += (e as Error).stack;
      }

      progress.log(
        promptDef,
        'error',
        'Failed to generate initial code using AI. Skipping this app.',
        details,
      );

      await cleanup();
      break;
    }

    const userJourneys = config.enableUserJourneyTesting
      ? await generateUserJourneysForApp(
          ratingLlm,
          rootPromptDef.name,
          defsToExecute[0].prompt,
          initialResponse.files,
          abortSignal,
        )
      : undefined;

    // TODO: Only execute the serve command on the "final working attempt".
    // TODO: Incorporate usage.
    const userJourneyAgentTaskInput: BrowserAgentTaskInput | undefined = userJourneys
      ? {
          userJourneys: userJourneys.result,
          appPrompt: defsToExecute[0].prompt,
        }
      : undefined;

    const attemptDetails: AttemptDetails[] = []; // Store details for assessment.json

    // Try to build the files in the root prompt directory.
    // This will also attempt to fix issues with the generated code.
    const attempt = await attemptBuildAndTest(
      config,
      evalID,
      env,
      rootPromptDef,
      directory,
      contextFiles,
      initialResponse,
      attemptDetails,
      abortSignal,
      workerConcurrencyQueue,
      progress,
      userJourneyAgentTaskInput,
    );

    if (!attempt) {
      await cleanup();
      break;
    }

    const score = await rateGeneratedCode(
      ratingLlm,
      env,
      promptDef,
      fullPromptText,
      attempt.outputFiles,
      attempt.buildResult,
      attempt.serveTestingResult,
      attempt.repairAttempts,
      attempt.axeRepairAttempts,
      abortSignal,
      progress,
      config.autoraterModel || DEFAULT_AUTORATER_MODEL_NAME,
      attempt.testResult ?? null,
      attempt.testRepairAttempts,
    );

    results.push({
      promptDef: {
        // Note: we don't pass the prompt def along directly,
        // because it can contain data that cannot be encoded.
        name: promptDef.name,
        prompt: promptDef.prompt,
      },
      outputFiles: attempt.outputFiles,
      finalAttempt: attempt,
      score,
      repairAttempts: attempt.repairAttempts,
      attemptDetails,
      userJourneys: userJourneys,
      axeRepairAttempts: attempt.axeRepairAttempts,
      toolLogs,
      testResult: attempt.testResult ?? null,
      testRepairAttempts: attempt.testRepairAttempts,
    } satisfies AssessmentResult);
  }

  await cleanup();
  return results;
}
