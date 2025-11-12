import {BuildResult, BuildResultStatus} from '../workers/builder/builder-types.js';
import {Environment} from '../configuration/environment.js';
import {ProgressLogger} from '../progress/progress-logger.js';
import {RootPromptDefinition} from '../shared-interfaces.js';
import {EvalID} from './executors/executor.js';
import PQueue from 'p-queue';

export enum BuildType {
  /** Initial build of an eval */
  INITIAL_BUILD,
  /** A build attempt as part of a repair. */
  REPAIR_ATTEMPT_BUILD,
  /** A build attempt as part of a repair */
  TEST_ATTEMPT_REPAIR,
}

/** Attempts to build the code. */
export async function runBuild(
  evalID: EvalID,
  appDirectoryPath: string,
  env: Environment,
  rootPromptDef: RootPromptDefinition,
  abortSignal: AbortSignal,
  workerConcurrencyQueue: PQueue,
  progress: ProgressLogger,
  type: BuildType,
): Promise<BuildResult> {
  let suffix: string;
  let label: string;
  switch (type) {
    case BuildType.INITIAL_BUILD:
      suffix = '';
      label = 'Initial build';
      break;
    case BuildType.REPAIR_ATTEMPT_BUILD:
      suffix = ' (for a repair attempt)';
      label = 'Repair build';
      break;
    case BuildType.TEST_ATTEMPT_REPAIR:
      suffix = ' (for a test repair attempt)';
      label = 'Test repair build';
      break;
  }

  progress.log(rootPromptDef, 'build', `Building the app${suffix}`);

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
      progress.log(rootPromptDef, 'success', `${label} is successful`);
    } else {
      progress.log(rootPromptDef, 'error', `${label} has failed`, result.message);
    }
    return result;
  } catch (err) {
    progress.log(rootPromptDef, 'error', `Error during ${label}`, err + '');
    throw err;
  }
}
