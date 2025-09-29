import z from 'zod';
import {mcpServerOptionsSchema} from '../../codegen/llm-runner.js';
import {getPossiblePackageManagers} from '../../configuration/package-managers.js';

export const localExecutorConfigSchema = z.strictObject({
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
  packageManager: z.enum(getPossiblePackageManagers()).optional().default('npm'),
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
   * Optional command for executing project tests.
   */
  testCommand: z.string().optional(),
  /**
   * Whether to skip installing dependencies when running evals in the environment.
   * Useful if you're managing dependencies yourself.
   */
  skipInstall: z.boolean().optional(),
});

export type LocalExecutorConfig = z.infer<typeof localExecutorConfigSchema>;
