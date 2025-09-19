import { globSync } from 'tinyglobby';
import { readFile } from 'fs/promises';
import { availableParallelism } from 'os';
import { randomUUID } from 'crypto';
import PQueue from 'p-queue';
import { basename, join } from 'path';
import { existsSync, readdirSync } from 'fs';
import { LlmGenerateFilesContext, LlmRunner } from '../codegen/llm-runner.js';
import {
  DEFAULT_AUTORATER_MODEL_NAME,
  LLM_OUTPUT_DIR,
  REPORT_VERSION,
} from '../configuration/constants.js';
import { Environment } from '../configuration/environment.js';
import { rateGeneratedCode } from '../ratings/rate-code.js';
import { summarizeReportWithAI } from '../reporting/ai-summarize.js';
import { redX } from '../reporting/format.js';
import {
  AssessmentResult,
  AttemptDetails,
  CompletionStats,
  LlmContextFile,
  MultiStepPromptDefinition,
  PromptDefinition,
  RootPromptDefinition,
  RunDetails,
  RunInfo,
  RunSummary,
  Usage,
} from '../shared-interfaces.js';
import { BrowserAgentTaskInput } from '../testing/browser-agent/models.js';
import { callWithTimeout } from '../utils/timeout.js';
import { attemptBuild } from './build.js';
import { generateCodeWithAI } from './codegen.js';
import { generateUserJourneysForApp } from './user-journeys.js';
import {
  resolveContextFiles,
  setupProjectStructure,
  writeResponseFiles,
} from './file-system.js';
import { GenkitRunner } from '../codegen/genkit/genkit-runner.js';
import { getEnvironmentByPath } from '../configuration/environment-resolution.js';
import { getPossiblePackageManagers } from '../configuration/environment-config.js';
import { ProgressLogger } from '../progress/progress-logger.js';
import { TextProgressLogger } from '../progress/text-progress-logger.js';
import { logReportHeader } from '../reporting/report-logging.js';
import { DynamicProgressLogger } from '../progress/dynamic-progress-logger.js';
import { UserFacingError } from '../utils/errors.js';
import { getRunGroupId } from './grouping.js';
import { executeCommand } from '../utils/exec.js';

/**
 * Orchestrates the entire assessment process for each prompt defined in the `prompts` array.
 * For each prompt, it:
 *
 * 1. Makes a request to Gemini to generate code.
 * 2. Attempts to build it in a template Angular project.
 * 3. If the build fails, it makes a number of "fix it" Gemini requests.
 * 4. Runs other validations and computes a score for generated output.
 *
 * @returns A Promise that resolves to an array of AssessmentResult objects,
 *          each containing the prompt, generated code, and final validation status.
 */
export async function generateCodeAndAssess(options: {
  llm: LlmRunner;
  ratingLlm: GenkitRunner;
  model: string;
  environmentConfigPath: string;
  localMode: boolean;
  limit: number;
  concurrency: number | 'auto';
  reportName: string;
  skipScreenshots: boolean;
  startMcp?: boolean;
  ragEndpoint?: string;
  outputDirectory?: string;
  promptFilter?: string;
  labels: string[];
  skipAiSummary?: boolean;
  skipAxeTesting: boolean;
  enableUserJourneyTesting?: boolean;
  enableAutoCsp?: boolean;
  logging?: 'text-only' | 'dynamic';
  autoraterModel?: string;
}): Promise<RunInfo> {
  const env = await getEnvironmentByPath(options.environmentConfigPath);
  const promptsToProcess = getCandidateExecutablePrompts(
    env,
    options.localMode,
    options.promptFilter
  ).slice(0, options.limit);
  const progress =
    options.logging === 'dynamic'
      ? new DynamicProgressLogger()
      : new TextProgressLogger();
  const appConcurrency =
    options.concurrency === 'auto'
      ? Math.floor(availableParallelism() * 0.8)
      : options.concurrency;

  if (promptsToProcess.length === 0) {
    throw new UserFacingError(
      `No prompts have been configured for environment '${env.displayName}'` +
        (options.promptFilter
          ? ` and filtered by '${options.promptFilter}'.`
          : '.')
    );
  }

  // Scrolls the terminal back to the top so that our logging looks a bit cleaner.
  // via https://stackoverflow.com/questions/9006988/node-js-on-windows-how-to-clear-console
  if (options.logging === 'dynamic') {
    process.stdout.write('\x1Bc');
  }

  logReportHeader(env, promptsToProcess.length, appConcurrency, options);

  // We need Chrome to collect runtime information.
  await installChrome();

  if (
    options.startMcp &&
    env.mcpServerOptions.length &&
    options.llm.startMcpServerHost
  ) {
    options.llm.startMcpServerHost(
      `mcp-${env.clientSideFramework.id}`,
      env.mcpServerOptions
    );
  }

  progress.initialize(promptsToProcess.length);

  const appConcurrencyQueue = new PQueue({ concurrency: appConcurrency });
  const workerConcurrencyQueue = new PQueue({
    concurrency:
      options.concurrency === 'auto'
        ? // Building can be really expensive. We likely should add support for "CPU hints" per environment.
          // E.g. CLI building is really CPU intensive with ESBuild being multi-core.
          // TODO: Follow-up on this and add CPU hints.
          Math.floor(availableParallelism() * 0.4 * 0.5)
        : Infinity,
  });

  const allTasks: Promise<AssessmentResult[]>[] = [];
  const failedPrompts: CompletionStats['failedPrompts'] = [];

  for (const rootPromptDef of promptsToProcess) {
    allTasks.push(
      appConcurrencyQueue.add(
        async () => {
          try {
            return await callWithTimeout(
              `Evaluation of ${rootPromptDef.name}`,
              async (abortSignal) =>
                startEvaluationTask(
                  env,
                  options.llm,
                  options.ratingLlm,
                  options.model,
                  rootPromptDef,
                  options.localMode,
                  options.skipScreenshots,
                  options.outputDirectory,
                  options.ragEndpoint,
                  abortSignal,
                  options.skipAxeTesting,
                  !!options.enableUserJourneyTesting,
                  !!options.enableAutoCsp,
                  workerConcurrencyQueue,
                  progress,
                  options.autoraterModel || DEFAULT_AUTORATER_MODEL_NAME
                ),
              // 10min max per app evaluation.  We just want to make sure it never gets stuck.
              10
            );
          } catch (e: unknown) {
            failedPrompts.push({
              promptName: rootPromptDef.name,
              error: `${e}`,
              stack: e instanceof Error ? e.stack : undefined,
            });

            let details = `Error: ${e}`;
            if (e instanceof Error && e.stack) {
              details += `\nStack: ${e.stack}`;
            }

            progress.log(
              rootPromptDef,
              'error',
              'Failed to evaluate code',
              details
            );
            return [] satisfies AssessmentResult[];
          } finally {
            progress.log(rootPromptDef, 'done', 'Done');
          }
        },
        { throwOnTimeout: true }
      )
    );
  }

  const results = (await Promise.all(allTasks))
    .flat()
    .sort((a, b) => a.promptDef.name.localeCompare(b.promptDef.name));

  // Sanity check. Should be a noop because app queue is a parent of worker-awaited tasks.
  await workerConcurrencyQueue.onEmpty();
  progress.finalize();

  const mcp =
    options.startMcp &&
    env.mcpServerOptions.length > 0 &&
    options.llm.startMcpServerHost &&
    options.llm.flushMcpServerLogs
      ? {
          servers: env.mcpServerOptions.map((m) => ({
            name: m.name,
            command: m.command,
            args: m.args,
          })),
          logs: options.llm.flushMcpServerLogs().join('\n'),
        }
      : undefined;

  const timestamp = new Date();
  const details = {
    summary: await prepareSummary(
      options.llm,
      options.ratingLlm,
      new AbortController().signal, // Note: AI summarization is currently not abortable.
      options.model,
      env,
      results,
      {
        allPromptsCount: promptsToProcess.length,
        failedPrompts,
      },
      options
    ),
    timestamp: timestamp.toISOString(),
    reportName: options.reportName,
    systemPromptGeneration: env.classifyPrompts
      ? 'Classified 🕵️'
      : env.systemPromptGeneration(),
    systemPromptRepair: env.classifyPrompts
      ? 'Classified 🕵️'
      : env.systemPromptRepair(),
    // Deduplicate labels before finalizing the report.
    labels: Array.from(new Set(options.labels)),
    mcp,
  } satisfies RunDetails;

  return {
    id: randomUUID(),
    group: getRunGroupId(timestamp, env, options),
    version: REPORT_VERSION,
    results,
    details,
  } satisfies RunInfo;
}

/**
 * Creates and executes a task to generate or load code for a given prompt,
 * attempt to build it, repair it if necessary, and assess its quality.
 *
 * This function handles both online (AI-generated) and local (file-based) code retrieval.
 * It manages build attempts and AI-driven repair cycles.
 *
 * @param framework Name of the framework to use.
 * @param llm LLM runner.
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
async function startEvaluationTask(
  env: Environment,
  llm: LlmRunner,
  ratingLlm: GenkitRunner,
  model: string,
  rootPromptDef: PromptDefinition | MultiStepPromptDefinition,
  localMode: boolean,
  skipScreenshots: boolean,
  outputDirectory: string | undefined,
  ragEndpoint: string | undefined,
  abortSignal: AbortSignal,
  skipAxeTesting: boolean,
  enableUserJourneyTesting: boolean,
  enableAutoCsp: boolean,
  workerConcurrencyQueue: PQueue,
  progress: ProgressLogger,
  autoraterModel: string
): Promise<AssessmentResult[]> {
  // Set up the project structure once for the root project.
  const { directory, cleanup } = await setupProjectStructure(
    env,
    rootPromptDef,
    progress,
    outputDirectory
  );

  const results: AssessmentResult[] = [];
  const defsToExecute =
    rootPromptDef.kind === 'single' ? [rootPromptDef] : rootPromptDef.steps;

  for (const promptDef of defsToExecute) {
    const [fullPromptText, systemInstructions] = await Promise.all([
      env.getPrompt(promptDef.systemPromptType, promptDef.prompt, ragEndpoint),
      env.getPrompt(promptDef.systemPromptType, ''),
    ]);

    // Resolve the context files from the root. We need to do this after the project is set up
    // and for each sub-prompt, because the project will be augmented on each iteration.
    const contextFiles = await resolveContextFiles(
      promptDef.contextFilePatterns,
      directory
    );

    // Generate the initial set of files through the LLM.
    const initialResponse = await generateInitialFiles(
      llm,
      model,
      env,
      promptDef,
      {
        directory,
        systemInstructions,
        combinedPrompt: fullPromptText,
        executablePrompt: promptDef.prompt,
        packageManager: env.packageManager,
        buildCommand: env.buildCommand,
        possiblePackageManagers: getPossiblePackageManagers().slice(),
      },
      contextFiles,
      localMode,
      abortSignal,
      progress
    );

    if (!initialResponse) {
      progress.log(
        promptDef,
        'error',
        'Failed to generate initial code using AI. Skipping this app.'
      );
      await cleanup();
      break;
    }

    try {
      // Write the generated files to disk.
      // Note: This can fail when the LLM e.g. produced a wrong file name that is too large,
      // and results in a file system error. Gracefully handle this so we can continue testing.
      // Write the generated files to disk within the project directory.
      await writeResponseFiles(
        directory,
        initialResponse.outputFiles,
        env,
        rootPromptDef.name
      );

      // If we're in a multi-step prompt, also write out to dedicated directories
      // for each sub-prompt so that we can inspect the output along the way.
      if (rootPromptDef.kind === 'multi-step') {
        await writeResponseFiles(
          directory,
          initialResponse.outputFiles,
          env,
          promptDef.name
        );
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
        details
      );

      await cleanup();
      break;
    }

    const userJourneys = await generateUserJourneysForApp(
      ratingLlm,
      rootPromptDef.name,
      defsToExecute[0].prompt,
      initialResponse.outputFiles,
      abortSignal
    );

    // TODO: Only execute the serve command on the "final working attempt".
    // TODO: Incorporate usage.
    const userJourneyAgentTaskInput: BrowserAgentTaskInput | undefined =
      enableUserJourneyTesting
        ? {
            userJourneys: userJourneys.result,
            appPrompt: defsToExecute[0].prompt,
          }
        : undefined;

    const attemptDetails: AttemptDetails[] = []; // Store details for assessment.json

    // Try to build the files in the root prompt directory.
    // This will also attempt to fix issues with the generated code.
    const attempt = await attemptBuild(
      llm,
      model,
      env,
      rootPromptDef,
      directory,
      contextFiles,
      initialResponse,
      attemptDetails,
      skipScreenshots,
      skipAxeTesting,
      enableAutoCsp,
      abortSignal,
      workerConcurrencyQueue,
      progress,
      userJourneyAgentTaskInput
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
      attempt.repairAttempts,
      attempt.axeRepairAttempts,
      abortSignal,
      progress,
      autoraterModel
    );

    results.push({
      promptDef: {
        // Note: we don't pass the prompt def along directly,
        // because it can contain data that cannot be encoded.
        name: promptDef.name,
        prompt: promptDef.prompt,
      },
      outputFiles: attempt.outputFiles,
      build: attempt.buildResult,
      score,
      repairAttempts: attempt.repairAttempts,
      attemptDetails,
      userJourneys: userJourneys,
      axeRepairAttempts: attempt.axeRepairAttempts,
    } satisfies AssessmentResult);
  }

  await cleanup();
  return results;
}

/**
 * Generates the initial files for a prompt using an LLM.
 * @param llm LLM runner.
 * @param model Name of the LLM to use.
 * @param env Environment that is currently being run.
 * @param promptName Name of the prompt being generated.
 * @param fullPromptText Full prompt to send to the LLM, including system instructions.
 * @param contextFiles Files that should be passed as context to the LLM.
 * @param localMode Whether the script is running in local mode.
 * @param abortSignal Signal to fire when this process should be aborted.
 */
async function generateInitialFiles(
  llm: LlmRunner,
  model: string,
  env: Environment,
  promptDef: RootPromptDefinition,
  codegenContext: LlmGenerateFilesContext,
  contextFiles: LlmContextFile[],
  localMode: boolean,
  abortSignal: AbortSignal,
  progress: ProgressLogger
) {
  if (localMode) {
    const localFilesDirectory = join(LLM_OUTPUT_DIR, env.id, promptDef.name);
    const filePaths = globSync('**/*', { cwd: localFilesDirectory });

    if (filePaths.length === 0) {
      throw new UserFacingError(
        `Could not find pre-existing files in ${localFilesDirectory}`
      );
    }

    return {
      outputFiles: await Promise.all(
        filePaths.map(async (filePath) => ({
          filePath,
          code: await readFile(join(localFilesDirectory, filePath), 'utf8'),
        }))
      ),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      } satisfies Usage,
      // TODO: We could also try save/restore reasoning locally.
      reasoning: '',
    };
  }

  const response = await generateCodeWithAI(
    llm,
    model,
    codegenContext,
    'codegen',
    promptDef,
    contextFiles,
    abortSignal,
    progress
  );

  if (!response.success) {
    throw new Error(
      `Initial file generation failed: ${response.errors.join('\n')}`
    );
  }

  return {
    outputFiles: response.outputFiles!,
    usage: response.usage,
    reasoning: response.reasoning,
  };
}

/**
 * Prepares a summary of build statuses and score distributions from a list of assessment results
 * and also some extra metadata about the run.
 */
async function prepareSummary(
  llm: LlmRunner,
  genkit: GenkitRunner,
  abortSignal: AbortSignal,
  model: string,
  env: Environment,
  assessments: AssessmentResult[],
  completionStats: CompletionStats,
  opts: { skipAiSummary?: boolean }
): Promise<RunSummary> {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  assessments.forEach((result) => {
    // Incorporate usage from running raters.
    if (result.score.tokenUsage) {
      inputTokens += result.score.tokenUsage.inputTokens;
      outputTokens += result.score.tokenUsage.outputTokens;
      totalTokens += result.score.tokenUsage.totalTokens ?? 0;
    }

    // Incorporate usage numbers from all generate + build attempts.
    result.attemptDetails.forEach((attempt) => {
      if (attempt.usage) {
        inputTokens += attempt.usage.inputTokens ?? 0;
        outputTokens += attempt.usage.outputTokens ?? 0;
        totalTokens += attempt.usage.totalTokens ?? 0;
      }
    });
  });

  let aiSummary: string | undefined = undefined;
  if (!opts.skipAiSummary) {
    try {
      const result = await summarizeReportWithAI(
        genkit,
        abortSignal,
        assessments
      );
      inputTokens += result.usage.inputTokens;
      outputTokens += result.usage.outputTokens;
      totalTokens += result.usage.totalTokens;
      aiSummary = result.summary;
    } catch (e) {
      console.error(`${redX()} Failed to generate AI summary for report: ${e}`);
      if ((e as Partial<Error>).stack) {
        console.error((e as Error).stack);
      }
    }
  }

  return {
    model,
    environmentId: env.id,
    displayName: env.displayName,
    framework: {
      fullStackFramework: {
        id: env.fullStackFramework.id,
        displayName: env.fullStackFramework.displayName,
      },
      clientSideFramework: {
        id: env.clientSideFramework.id,
        displayName: env.clientSideFramework.displayName,
      },
    },
    aiSummary,
    completionStats: completionStats,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
    },
    runner: {
      id: llm.id,
      displayName: llm.displayName,
    },
  } satisfies RunSummary;
}

/** Gets prompts that are candidates to be executed. */
function getCandidateExecutablePrompts(
  env: Environment,
  localMode: boolean,
  promptFilter: string | undefined
): RootPromptDefinition[] {
  const envDir = join(LLM_OUTPUT_DIR, env.id);
  let result = env.executablePrompts;

  // In local mode filter the list of prompts down to
  // only the ones that we have local output for.
  if (localMode && existsSync(envDir)) {
    const localPromptNames = readdirSync(envDir, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => basename(entry.name));

    result = result.filter(({ name }) => localPromptNames.includes(name));
  }

  // If there's no prompt filter, shuffle the array to introduce some randomness.
  if (!promptFilter) {
    return shuffleArray(result);
  }

  // Otherwise only filter by name, but don't shuffle since
  // the user appears to be targeting a specific prompt.
  return result.filter(({ name }) => name.includes(promptFilter));
}

let chromeInstallPromise: Promise<unknown> | null = null;

/** Installs Chrome which is necessary for runtime checks. */
async function installChrome(): Promise<void> {
  // Ensure that Chrome is installed. Note that the
  // installation is global so we can reuse the promise.
  if (!chromeInstallPromise) {
    chromeInstallPromise = executeCommand(
      'npx puppeteer browsers install chrome',
      // The command needs to run in a directory whose closest node_modules contain `puppeteer`.
      import.meta.dirname
    );
  }

  try {
    await chromeInstallPromise;
  } catch {}
}

/**
 * Shuffles the elements of an array randomly in place.
 *
 * @param items An array of items to be shuffled.
 * @returns The same array with its elements shuffled.
 *          Note: The original array is modified directly.
 */
function shuffleArray<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
