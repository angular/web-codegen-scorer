import {UserFacingError} from '../utils/errors.js';
import type {GeminiCliRunner} from './gemini-cli-runner.js';
import type {GenkitRunner} from './genkit/genkit-runner.js';

interface AvailableRunners {
  genkit: GenkitRunner;
  'gemini-cli': GeminiCliRunner;
}

/** Names of supported runners. */
export type RunnerName = keyof AvailableRunners;

/** Creates an `LlmRunner` based on a name. */
export async function getRunnerByName<T extends RunnerName>(name: T): Promise<AvailableRunners[T]> {
  // Note that we lazily import and resolve the runners here, because their imports
  // might have side effects. E.g. Genkit installs a listener on the process exiting
  // in order to kill pending instances and log "Closing all Genkit instances".
  // We don't want to trigger those side effects unless we actually need them.
  switch (name) {
    case 'genkit':
      return import('./genkit/genkit-runner.js').then(
        m => new m.GenkitRunner() as AvailableRunners[T],
      );
    case 'gemini-cli':
      return import('./gemini-cli-runner.js').then(
        m => new m.GeminiCliRunner() as AvailableRunners[T],
      );
    default:
      throw new UserFacingError(`Unsupported runner ${name}`);
  }
}
