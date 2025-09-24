import z from 'zod';
import { Gateway } from '../orchestration/gateway.js';
import { BaseEnvironment } from './base-environment.js';
import { baseEnvironmentConfigSchema } from './base-environment-config.js';

export const remoteEnvironmentConfigSchema = baseEnvironmentConfigSchema.extend(
  {
    // TODO: Follow-up with a gateway validator, or make class abstract.
    gateway: z.custom<Gateway<RemoteEnvironment>>(),
  }
);

export type RemoteEnvironmentConfig = z.infer<
  typeof remoteEnvironmentConfigSchema
>;

/** Represents a single prompt evaluation environment. */
export class RemoteEnvironment extends BaseEnvironment {
  gateway: Gateway<RemoteEnvironment>;

  constructor(rootPath: string, config: RemoteEnvironmentConfig) {
    super(rootPath, config);
    this.gateway = config.gateway;
  }
}
