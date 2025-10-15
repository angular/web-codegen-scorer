import {randomUUID} from 'crypto';
import {existsSync, readdirSync} from 'fs';
import {availableParallelism} from 'os';
import PQueue from 'p-queue';
import {basename, join} from 'path';
import {assertValidModelName} from '../codegen/llm-runner.js';
import {getRunnerByName} from '../codegen/runner-creation.js';
import {LLM_OUTPUT_DIR, REPORT_VERSION} from '../configuration/constants.js';
import {getEnvironmentByPath} from '../configuration/environment-resolution.js';
import {Environment} from '../configuration/environment.js';
import {DynamicProgressLogger} from '../progress/dynamic-progress-logger.js';
import {TextProgressLogger} from '../progress/text-progress-logger.js';
import {logReportHeader} from '../reporting/report-logging.js';
import {
  AssessmentConfig,
  AssessmentResult,
  CompletionStats,
  RootPromptDefinition,
  RunDetails,
  RunInfo,
} from '../shared-interfaces.js';
import {UserFacingError} from '../utils/errors.js';
import {executeCommand} from '../utils/exec.js';
import {callWithTimeout} from '../utils/timeout.js';
import {LocalExecutor} from './executors/local-executor.js';
import {startEvaluationTask} from './generate-eval-task.js';
import {prepareSummary} from './generate-summary.js';
import {getRunGroupId} from './grouping.js';
import {combineAbortSignals} from '../utils/abort-signal.js';

/**
 * Orchestrates the entire assessment process for each prompt defined in the `prompts` array.
 * For each prompt, it:
 *
 * 1. Makes a request to Gemini to generate code.
 * 2. Attempts to build it in a template Angular project.
 * 3. If the build fails, it makes a number of "fix it" Gemini requests.
 * 4. If configured, runs unit tests and attempts to repair test failures.
 * 5. Runs other validations and computes a score for generated output.
 *
 * @returns A Promise that resolves to an array of AssessmentResult objects,
 *          each containing the prompt, generated code, and final validation status.
 */
export async function generateCodeAndAssess(options: AssessmentConfig): Promise<RunInfo> {
  const env = await getEnvironmentByPath(options.environmentConfigPath, options.runner);
  const cleanup = async () => {
    await env.executor.destroy();
  };

  // Ensure cleanup logic runs when the evaluation is aborted.
  options.abortSignal?.addEventListener('abort', cleanup);

  const ratingLlm = await getRunnerByName('genkit');

  await assertValidModelName(options.model, env.executor);

  try {
    const promptsToProcess = getCandidateExecutablePrompts(
      env,
      options.localMode,
      options.promptFilter,
    ).slice(0, options.limit);
    const progress =
      options.logging === 'dynamic' ? new DynamicProgressLogger() : new TextProgressLogger();
    const appConcurrency =
      options.concurrency === 'auto'
        ? Math.floor(availableParallelism() * 0.8)
        : options.concurrency;

    if (promptsToProcess.length === 0) {
      throw new UserFacingError(
        `No prompts have been configured for environment '${env.displayName}'` +
          (options.promptFilter ? ` and filtered by '${options.promptFilter}'.` : '.'),
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

    const mcpServerDetails =
      env.executor instanceof LocalExecutor && options.startMcp && env.executor.startMcpServerHost
        ? await env.executor.startMcpServerHost(`mcp-${env.clientSideFramework.id}`)
        : undefined;

    progress.initialize(promptsToProcess.length);

    const appConcurrencyQueue = new PQueue({concurrency: appConcurrency});
    const workerConcurrencyQueue = new PQueue({
      concurrency:
        options.concurrency === 'auto'
          ? // Building can be really expensive. We likely should add support for "CPU hints" per environment.
            // E.g. CLI building is really CPU intensive with ESBuild being multi-core.
            // TODO: Follow-up on this and add CPU hints.
            Math.floor(appConcurrency * 0.5)
          : Infinity,
    });

    const allTasks: Promise<AssessmentResult[]>[] = [];
    const failedPrompts: CompletionStats['failedPrompts'] = [];

    for (const rootPromptDef of promptsToProcess) {
      allTasks.push(
        appConcurrencyQueue.add(async () => {
          const evalID = await env.executor.initializeEval();
          let results: AssessmentResult[] | undefined;

          try {
            results = await callWithTimeout(
              `Evaluation of ${rootPromptDef.name}`,
              async timeoutAbortSignal =>
                startEvaluationTask(
                  options,
                  evalID,
                  env,
                  ratingLlm,
                  rootPromptDef,
                  combineAbortSignals(timeoutAbortSignal, options.abortSignal),
                  workerConcurrencyQueue,
                  progress,
                ),
              // 30min max per app evaluation. We just want to make sure it never gets stuck.
              // Note that this timeout is expected to never be hit as individual action timeouts
              // should fire first. E.g. local executor build or test timeouts.
              30,
            );
            return results;
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

            progress.log(rootPromptDef, 'error', 'Failed to evaluate code', details);
            return [] satisfies AssessmentResult[];
          } finally {
            progress.evalFinished(rootPromptDef, results || []);
            await env.executor.finalizeEval(evalID);
          }
        }),
      );
    }

    const results = (await Promise.all(allTasks))
      .flat()
      .sort((a, b) => a.promptDef.name.localeCompare(b.promptDef.name));

    // Sanity check. Should be a noop because app queue is a parent of worker-awaited tasks.
    await workerConcurrencyQueue.onEmpty();
    progress.finalize();

    const mcp =
      env.executor instanceof LocalExecutor && options.startMcp
        ? await env.executor.collectMcpServerLogs(mcpServerDetails)
        : undefined;

    const timestamp = new Date();
    const details = {
      summary: await prepareSummary(
        ratingLlm,
        new AbortController().signal, // Note: AI summarization is currently not abortable.
        options.model,
        env,
        results,
        {
          allPromptsCount: promptsToProcess.length,
          failedPrompts,
        },
        options,
      ),
      timestamp: timestamp.toISOString(),
      reportName: options.reportName,
      systemPromptGeneration: env.classifyPrompts ? 'Classified 🕵️' : env.systemPromptGeneration(),
      systemPromptRepair: env.classifyPrompts ? 'Classified 🕵️' : env.systemPromptRepair(),
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
  } finally {
    await cleanup();

    // Remove potential abort listeners to avoid memory leaks.
    options.abortSignal?.removeEventListener('abort', cleanup);
  }
}

/** Gets prompts that are candidates to be executed. */
function getCandidateExecutablePrompts(
  env: Environment,
  localMode: boolean,
  promptFilter: string | undefined,
): RootPromptDefinition[] {
  const envDir = join(LLM_OUTPUT_DIR, env.id);
  let result = env.executablePrompts;

  // In local mode filter the list of prompts down to
  // only the ones that we have local output for.
  if (localMode && existsSync(envDir)) {
    const localPromptNames = readdirSync(envDir, {
      withFileTypes: true,
    })
      .filter(entry => entry.isDirectory())
      .map(entry => basename(entry.name));

    result = result.filter(({name}) => localPromptNames.includes(name));
  }

  // If there's no prompt filter, shuffle the array to introduce some randomness.
  if (!promptFilter) {
    return shuffleArray(result);
  }

  // Otherwise only filter by name, but don't shuffle since
  // the user appears to be targeting a specific prompt.
  return result.filter(({name}) => name.includes(promptFilter));
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
      import.meta.dirname,
    );
  }

  try {
    await chromeInstallPromise;
  } catch {} // Ignore errors here, as it might be already installed.
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
