import PQueue from 'p-queue';
import {RootPromptDefinition, TestExecutionResult} from '../shared-interfaces.js';
import {ProgressLogger} from '../progress/progress-logger.js';
import {Environment} from '../configuration/environment.js';
import {EvalID} from './executors/executor.js';

export async function runTest(
  env: Environment,
  evalID: EvalID,
  appDirectoryPath: string,
  rootPromptDef: RootPromptDefinition,
  abortSignal: AbortSignal,
  workerConcurrencyQueue: PQueue,
  progress: ProgressLogger,
): Promise<TestExecutionResult | null> {
  progress.log(rootPromptDef, 'test', `Running tests`);

  try {
    const result = await env.executor.executeProjectTests(
      evalID,
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
