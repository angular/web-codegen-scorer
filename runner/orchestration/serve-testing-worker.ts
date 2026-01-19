import {ChildProcess, fork} from 'node:child_process';
import path from 'node:path';
import {Environment} from '../configuration/environment.js';
import {ProgressLogger} from '../progress/progress-logger.js';
import {AssessmentConfig, RootPromptDefinition} from '../shared-interfaces.js';
import {killChildProcessWithSigterm} from '../utils/kill-gracefully.js';
import {
  ServeTestingResult,
  ServeTestingWorkerMessage,
  ServeTestingWorkerResponseMessage,
} from '../workers/serve-testing/worker-types.js';
import {EvalID} from './executors/executor.js';
import {BrowserAgentTaskInput} from '../testing/browser-agent/models.js';
import PQueue from 'p-queue';

/** Attempts to run & test an eval app. */
export async function serveAndTestApp(
  config: AssessmentConfig,
  evalID: EvalID,
  appDirectoryPath: string,
  env: Environment,
  rootPromptDef: RootPromptDefinition,
  workerConcurrencyQueue: PQueue,
  abortSignal: AbortSignal,
  progress: ProgressLogger,
  userJourneyAgentTaskInput?: BrowserAgentTaskInput,
): Promise<ServeTestingResult | null> {
  if (env.executor.serveWebApplication === null) {
    return null;
  }

  progress.log(rootPromptDef, 'serve-testing', `Validating the running app`);

  const result = await env.executor.serveWebApplication(
    evalID,
    appDirectoryPath,
    rootPromptDef,
    progress,
    abortSignal,
    async serveUrl => {
      progress.log(rootPromptDef, 'serve-testing', `Validating the running app (URL: ${serveUrl})`);
      const serveParams: ServeTestingWorkerMessage = {
        serveUrl,
        appName: rootPromptDef.name,
        enableAutoCsp: !!config.enableAutoCsp,
        includeAxeTesting: config.skipAxeTesting === false,
        takeScreenshots: config.skipScreenshots === false,
        includeLighthouseData: config.skipLighthouse !== true,
        userJourneyAgentTaskInput,
      };

      return await workerConcurrencyQueue.add(
        () =>
          new Promise<ServeTestingResult>((resolve, reject) => {
            const child: ChildProcess = fork(
              path.resolve(import.meta.dirname, '../workers/serve-testing/worker.js'),
              {signal: abortSignal},
            );
            child.send(serveParams);

            child.on('message', async (result: ServeTestingWorkerResponseMessage) => {
              if (result.type === 'result') {
                try {
                  await killChildProcessWithSigterm(child);
                } catch (e) {
                  progress.debugLog(`Error while killing serve testing worker: ${e}`);
                }
                resolve(result.payload);
              } else {
                progress.log(
                  rootPromptDef,
                  result.payload.state,
                  result.payload.message,
                  result.payload.details,
                );
              }
            });
            child.on('error', async err => {
              try {
                await killChildProcessWithSigterm(child);
              } catch (e) {
                progress.debugLog(`Error while killing serve testing worker: ${e}`);
              }
              reject(err);
            });
          }),
      );
    },
  );

  // An executor might define `serveWebApplication` but conditionally decide
  // that no web application can be started/served.
  if (result === null) {
    return null;
  }

  if (result.errorMessage === undefined) {
    progress.log(rootPromptDef, 'success', 'Validation of running app is successful');
  } else {
    progress.log(rootPromptDef, 'error', 'Validation of running app failed', result.errorMessage);
  }

  return result;
}
