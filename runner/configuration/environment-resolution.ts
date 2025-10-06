import {existsSync} from 'fs';
import {dirname} from 'path';
import {fromZodError} from 'zod-validation-error/v3';
import {RunnerName} from '../codegen/runner-creation.js';
import {toProcessAbsolutePath} from '../file-system-utils.js';
import {Executor} from '../orchestration/executors/executor.js';
import {localExecutorConfigSchema} from '../orchestration/executors/local-executor-config.js';
import {LocalExecutor} from '../orchestration/executors/local-executor.js';
import {UserFacingError} from '../utils/errors.js';
import {assertIsEnvironmentConfig, environmentConfigSchema} from './environment-config.js';
import {Environment} from './environment.js';

const environmentsCache = new Map<string, Environment>();

/** Gets an environment with a specific config path. */
export async function getEnvironmentByPath(
  configPath: string,
  runnerCliOption: RunnerName,
): Promise<Environment> {
  configPath = toProcessAbsolutePath(configPath);

  if (environmentsCache.has(configPath)) {
    return environmentsCache.get(configPath)!;
  }

  if (!existsSync(configPath)) {
    throw new UserFacingError(`Cannot find environment config file at ${configPath}`);
  }

  const result: {default: unknown} = await import(configPath);
  const rootPath = dirname(configPath);
  const config = result.default;
  assertIsEnvironmentConfig(config);

  let executor: Executor | undefined = config.executor;

  // Safety check to ensure `executor` is not configured while backwards-compatibility
  // executor options are set at the top-level configuration.
  if (executor !== undefined) {
    const strictTopLevelSchema = environmentConfigSchema.strict().safeParse(config);
    if (!strictTopLevelSchema.data || !strictTopLevelSchema.success) {
      throw new Error(
        fromZodError(strictTopLevelSchema.error, {
          prefix:
            `Environment config cannot contain local executor configuration ` +
            `fields if \`executor\` is set.`,
          prefixSeparator: '\n',
          issueSeparator: '\n',
        }).toString(),
      );
    }
  } else {
    const backwardsCompatTopLevelConfig = localExecutorConfigSchema.passthrough().safeParse(config);
    if (!backwardsCompatTopLevelConfig.data || !backwardsCompatTopLevelConfig.success) {
      throw new Error(
        fromZodError(backwardsCompatTopLevelConfig.error, {
          prefix: 'Environment config does not properly configure local executor.',
          prefixSeparator: '\n',
          issueSeparator: '\n',
        }).toString(),
      );
    }
    executor = new LocalExecutor(backwardsCompatTopLevelConfig.data, runnerCliOption);
  }

  const environment = new Environment(rootPath, {...config, executor});
  environmentsCache.set(configPath, environment);
  return environmentsCache.get(configPath)!;
}
