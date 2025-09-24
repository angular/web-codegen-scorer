import z from 'zod';
import { createMessageBuilder, fromError } from 'zod-validation-error/v3';
import { UserFacingError } from '../utils/errors.js';
import {
  LocalEnvironmentConfig,
  localEnvironmentConfigSchema,
} from './environment-local.js';
import {
  RemoteEnvironmentConfig,
  remoteEnvironmentConfigSchema,
} from './environment-remote.js';

const environmentConfigSchema = z.union([
  localEnvironmentConfigSchema,
  remoteEnvironmentConfigSchema,
]);

/**
 * Shape of the object that configures an individual evaluation environment. Not intended to direct
 * reads, interact with the information through the `Environment` class.
 */
export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>;

/** Package managers that are currently supported. */
export function getPossiblePackageManagers() {
  return ['npm', 'pnpm', 'yarn'] as const;
}

/** Asserts that the specified data is a valid environment config. */
export function assertIsEnvironmentConfig(
  value: unknown
): asserts value is EnvironmentConfig {
  const validationResult = environmentConfigSchema.safeParse(value);

  if (!validationResult.success) {
    // TODO: we can use `z.prettifyError` once we update to zod v4,
    // but last time the update caused some issues with Genkit.
    const message = fromError(validationResult.error, {
      messageBuilder: createMessageBuilder({
        prefix: 'Environment parsing failed:',
        prefixSeparator: '\n',
        issueSeparator: '\n',
      }),
    }).toString();

    throw new UserFacingError(message);
  }
}

export function isLocalEnvironmentConfig(
  config: EnvironmentConfig
): config is LocalEnvironmentConfig {
  return (config as Partial<RemoteEnvironmentConfig>).gateway === undefined;
}
