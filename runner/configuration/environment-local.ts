import { join } from 'path';
import z from 'zod';
import {
  LlmRunner,
  McpServerOptions,
  mcpServerOptionsSchema,
} from '../codegen/llm-runner.js';
import { LocalGateway } from '../orchestration/gateways/local_gateway.js';
import { BaseEnvironment } from './base-environment.js';
import {
  EnvironmentConfig,
  getPossiblePackageManagers,
} from './environment-config.js';
import { baseEnvironmentConfigSchema } from './base-environment-config.js';

export const localEnvironmentConfigSchema = baseEnvironmentConfigSchema.extend({
  /** MCP servers that can be started for this environment. */
  mcpServers: z.array(mcpServerOptionsSchema).optional(),
  /** Relative path to the environment's source code in which to generate new code. */
  sourceDirectory: z.string().optional(),
  /**
   * Path to the template directory to use when creating
   * the project which the LLM will run against.
   */
  projectTemplate: z.string().optional(),
  /** Package manager to use for the eval. */
  packageManager: z.enum(getPossiblePackageManagers()).optional(),
  /**
   * Command to run when building the generated code.
   * Defaults to `<package manager> run build`.
   */
  buildCommand: z.string().optional(),
  /**
   * Command to run when starting a development server inside the app.
   * Defaults to `<package manager> run start --port 0`.
   */
  serveCommand: z.string().optional(),
  /**
   * Whether to skip installing dependencies when running evals in the environment.
   * Useful if you're managing dependencies yourself.
   */
  skipInstall: z.boolean().optional(),
});

export type LocalEnvironmentConfig = z.infer<
  typeof localEnvironmentConfigSchema
>;

/** Represents a single prompt evaluation environment. */
export class LocalEnvironment extends BaseEnvironment {
  /** Configured package manager for the environment. */
  readonly packageManager: string;
  /** Command used to install dependencies. */
  readonly installCommand: string;
  /** Command to run when building the generated code. */
  readonly buildCommand: string;
  /** Command to run when starting a development server inside the app. */
  readonly serveCommand: string;
  /**
   * Absolute path at which files specific to this environment are located. Will be merged in
   * with the files from the `projectTemplatePath` to get the final project structure.
   */
  readonly sourceDirectory: string | null;
  /**
   * Directory serving as a template for the environment.
   * Files from the `sourceDirectory` will be applied on top to get the final project structure.
   */
  readonly projectTemplatePath: string | null;
  /** Options for MCP servers that should be started as a part of this environment. */
  readonly mcpServerOptions: McpServerOptions[];
  /** Whether to skip installing dependencies. */
  readonly skipInstall: boolean;
  /** Gateway for interacting with the environment. */
  gateway: LocalGateway;

  constructor(
    rootPath: string,
    config: LocalEnvironmentConfig,
    readonly llm: LlmRunner
  ) {
    super(rootPath, config);

    this.gateway = new LocalGateway(llm);

    const packageManager = config.packageManager || 'npm';
    const projectTemplatePath = config.projectTemplate
      ? join(rootPath, config.projectTemplate)
      : null;
    const sourceDirectory = config.sourceDirectory
      ? join(rootPath, config.sourceDirectory)
      : null;
    this.packageManager = packageManager;
    this.installCommand = `${packageManager} install --silent`;
    this.buildCommand = config.buildCommand || `${packageManager} run build`;
    this.serveCommand =
      config.serveCommand || this.getDefaultServeCommand(packageManager);
    this.projectTemplatePath = projectTemplatePath;
    this.sourceDirectory = sourceDirectory;
    this.mcpServerOptions = config.mcpServers || [];
    this.skipInstall = config.skipInstall ?? false;
  }

  private getDefaultServeCommand(
    packageManager: LocalEnvironmentConfig['packageManager']
  ): string {
    const flags = '--port 0';

    // npm needs -- to pass flags to the command.
    if (packageManager === 'npm') {
      return `npm run start -- ${flags}`;
    }

    return `${packageManager} run start ${flags}`;
  }
}
