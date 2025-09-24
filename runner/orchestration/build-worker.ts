import {
  BuildResult,
  BuildResultStatus,
} from '../workers/builder/builder-types.js';
import { Environment } from '../configuration/environment.js';
import { ProgressLogger } from '../progress/progress-logger.js';
import { RootPromptDefinition } from '../shared-interfaces.js';
import { EvalID, Gateway } from './gateway.js';

/** Attempts to build the code. */
export async function runBuild(
  evalID: EvalID,
  gateway: Gateway<Environment>,
  appDirectoryPath: string,
  env: Environment,
  rootPromptDef: RootPromptDefinition,
  progress: ProgressLogger
): Promise<BuildResult> {
  progress.log(rootPromptDef, 'build', `Building the app`);

  try {
    const result = await gateway.tryBuild(
      evalID,
      env,
      appDirectoryPath,
      rootPromptDef,
      progress
    );
    if (result.status === BuildResultStatus.SUCCESS) {
      progress.log(rootPromptDef, 'success', 'Build is successful');
    } else {
      progress.log(rootPromptDef, 'error', 'Build has failed', result.message);
    }
    return result;
  } catch (err) {
    progress.log(
      rootPromptDef,
      'error',
      `Error during build process`,
      err + ''
    );
    throw err;
  }
}
