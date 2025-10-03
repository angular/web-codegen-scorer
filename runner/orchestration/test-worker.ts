import PQueue from 'p-queue';
import {RootPromptDefinition, TestExecutionResult} from '../shared-interfaces.js';
import {ProgressLogger} from '../progress/progress-logger.js';
import {EvalID, Gateway} from './gateway.js';
import {Environment} from '../configuration/environment.js';

export async function runTest(
  evalID: EvalID,
  gateway: Gateway<Environment>,
  appDirectoryPath: string,
  env: Environment,
  rootPromptDef: RootPromptDefinition,
  abortSignal: AbortSignal,
  workerConcurrencyQueue: PQueue,
  progress: ProgressLogger,
): Promise<TestExecutionResult | null> {
  progress.log(rootPromptDef, 'test', `Running tests`);

  try {
    const result = await gateway.tryTest(
      evalID,
      env,
      appDirectoryPath,
      rootPromptDef,
      workerConcurrencyQueue,
      abortSignal,
      progress,
    );
    if (result === null) {
      return result;
    }

    if (result.passed) {
      progress.log(rootPromptDef, 'success', 'Tests have passed');
    } else {
      progress.log(rootPromptDef, 'error', 'Tests have failed');
    }

    return result;
  } catch (err) {
    progress.log(rootPromptDef, 'error', `Error when executing tests`, err + '');
    throw err;
  }
}
