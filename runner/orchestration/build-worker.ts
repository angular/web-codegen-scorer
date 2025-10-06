import {BuildResult, BuildResultStatus} from '../workers/builder/builder-types.js';
import {Environment} from '../configuration/environment.js';
import {ProgressLogger} from '../progress/progress-logger.js';
import {RootPromptDefinition} from '../shared-interfaces.js';
import {EvalID, Executor} from './executors/executor.js';
import PQueue from 'p-queue';

/** Attempts to build the code. */
export async function runBuild(
  evalID: EvalID,
  appDirectoryPath: string,
  env: Environment,
  rootPromptDef: RootPromptDefinition,
  abortSignal: AbortSignal,
  workerConcurrencyQueue: PQueue,
  progress: ProgressLogger,
): Promise<BuildResult> {
  progress.log(rootPromptDef, 'build', `Building the app`);

  try {
    const result = await env.executor.performBuild(
      evalID,
      appDirectoryPath,
      rootPromptDef,
      workerConcurrencyQueue,
      abortSignal,
      progress,
    );
    if (result.status === BuildResultStatus.SUCCESS) {
      progress.log(rootPromptDef, 'success', 'Build is successful');
    } else {
      progress.log(rootPromptDef, 'error', 'Build has failed', result.message);
    }
    return result;
  } catch (err) {
    progress.log(rootPromptDef, 'error', `Error during build process`, err + '');
    throw err;
  }
}
