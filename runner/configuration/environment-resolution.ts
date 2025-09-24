import { dirname } from 'path';
import { existsSync } from 'fs';
import {
  assertIsEnvironmentConfig,
  isLocalEnvironmentConfig,
} from './environment-config.js';
import { toProcessAbsolutePath } from '../file-system-utils.js';
import { UserFacingError } from '../utils/errors.js';
import { Environment } from './environment.js';
import { LocalEnvironment } from './environment-local.js';
import { RemoteEnvironment } from './environment-remote.js';
import { getRunnerByName, RunnerName } from '../codegen/runner-creation.js';

const environmentsCache = new Map<string, Environment>();

/** Gets an environment with a specific config path. */
export async function getEnvironmentByPath(
  configPath: string,
  runnerCliOption: RunnerName
): Promise<Environment> {
  configPath = toProcessAbsolutePath(configPath);

  if (environmentsCache.has(configPath)) {
    return environmentsCache.get(configPath)!;
  }

  if (!existsSync(configPath)) {
    throw new UserFacingError(
      `Cannot find environment config file at ${configPath}`
    );
  }

  const result: { default: unknown } = await import(configPath);
  const rootPath = dirname(configPath);
  assertIsEnvironmentConfig(result.default);
  const environment = isLocalEnvironmentConfig(result.default)
    ? new LocalEnvironment(
        rootPath,
        result.default,
        await getRunnerByName(runnerCliOption)
      )
    : new RemoteEnvironment(rootPath, result.default);

  environmentsCache.set(configPath, environment);
  return environmentsCache.get(configPath)!;
}
