import { ChildProcess, fork } from 'node:child_process';
import path from 'node:path';
import { Environment } from '../configuration/environment.js';
import { ProgressLogger } from '../progress/progress-logger.js';
import { RootPromptDefinition } from '../shared-interfaces.js';
import { killChildProcessGracefully } from '../utils/kill-gracefully.js';
import {
  ServeTestingResult,
  ServeTestingWorkerMessage,
  ServeTestingWorkerResponseMessage,
} from '../workers/serve-testing/worker-types.js';
import { EvalID, Gateway } from './gateway.js';
import { BrowserAgentTaskInput } from '../testing/browser-agent/models.js';
import PQueue from 'p-queue';

/** Attempts to run & test an eval app. */
export async function serveAndTestApp(
  evalID: EvalID,
  gateway: Gateway<Environment>,
  appDirectoryPath: string,
  env: Environment,
  rootPromptDef: RootPromptDefinition,
  workerConcurrencyQueue: PQueue,
  abortSignal: AbortSignal,
  progress: ProgressLogger,
  skipScreenshots: boolean,
  skipAxeTesting: boolean,
  enableAutoCsp: boolean,
  userJourneyAgentTaskInput?: BrowserAgentTaskInput
): Promise<ServeTestingResult> {
  progress.log(rootPromptDef, 'serve-testing', `Testing the app`);

  const result = await gateway.serveBuild(
    evalID,
    env,
    appDirectoryPath,
    rootPromptDef,
    progress,
    async (serveUrl) => {
      const serveParams: ServeTestingWorkerMessage = {
        serveUrl,
        appName: rootPromptDef.name,
        enableAutoCsp,
        includeAxeTesting: skipAxeTesting === false,
        takeScreenshots: skipScreenshots === false,
        userJourneyAgentTaskInput,
      };

      return await workerConcurrencyQueue.add(
        () =>
          new Promise<ServeTestingResult>((resolve, reject) => {
            const child: ChildProcess = fork(
              path.resolve(
                import.meta.dirname,
                '../workers/serve-testing/worker.js'
              ),
              { signal: abortSignal }
            );
            child.send(serveParams);

            child.on(
              'message',
              async (result: ServeTestingWorkerResponseMessage) => {
                if (result.type === 'result') {
                  await killChildProcessGracefully(child);
                  resolve(result.payload);
                } else {
                  progress.log(
                    rootPromptDef,
                    result.payload.state,
                    result.payload.message,
                    result.payload.details
                  );
                }
              }
            );
            child.on('error', async (err) => {
              await killChildProcessGracefully(child);
              reject(err);
            });
          }),
        { throwOnTimeout: true }
      );
    }
  );

  if (result.errorMessage === undefined) {
    progress.log(rootPromptDef, 'success', 'Testing is successful');
  } else {
    progress.log(
      rootPromptDef,
      'error',
      'Testing has failed',
      result.errorMessage
    );
  }

  return result;
}
