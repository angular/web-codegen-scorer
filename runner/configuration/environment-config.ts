import z from 'zod';
import {createMessageBuilder, fromError} from 'zod-validation-error/v3';
import {UserFacingError} from '../utils/errors.js';
import {ratingSchema} from '../ratings/rating-types.js';
import {MultiStepPrompt} from './multi-step-prompt.js';
import {executorSchema} from '../orchestration/executors/executor.js';
import {
  LocalExecutorConfig,
  localExecutorConfigSchema,
} from '../orchestration/executors/local-executor-config.js';

export const environmentConfigSchema = z.object({
  /** Display name for the environment. */
  displayName: z.string(),
  /**
   * Optional unique ID for the environment.
   * If one isn't provided, it will be computed from the `displayName`.
   */
  id: z.string().optional(),
  /** ID of the client-side framework used within the environment. */
  clientSideFramework: z.string(),
  /** Ratings to run when evaluating the environment. */
  ratings: z.array(ratingSchema),
  /** Path to the prompt used by the LLM for generating files. */
  generationSystemPrompt: z.string(),
  /**
   * Path to the prompt used by the LLM for repairing builds or failures.
   *
   * If unset or `null`, the eval tool will use its default repair instructions.
   */
  repairSystemPrompt: z.union([z.string(), z.null()]).optional(),
  /**
   * Path to the prompt used by the LLM for editing.
   *
   * Prompts running after the initial generation are considered as editing (e.g. multi step prompts).
   * If `null`, the eval tool will use the generation prompt for edits.
   */
  editingSystemPrompt: z.union([z.string(), z.null()]).optional(),
  /** Prompts that should be sent to the LLM and written into the output. */
  executablePrompts: z.array(
    z.union([
      z.string(),
      z.strictObject({
        path: z.string(),
        name: z.string().optional(),
        ratings: z.array(ratingSchema).optional(),
      }),
      z.custom<MultiStepPrompt>(data => data instanceof MultiStepPrompt),
    ]),
  ),
  /**
   * ID of the fullstack framework used within the environment.
   * If omitted, it will default to the `clientSideFramework`.
   */
  fullStackFramework: z.string().optional(),
  /** Path to the prompt to use when rating code. */
  codeRatingPrompt: z.string().optional(),
  /** When enabled, the system prompts for this environment won't be included in the report. */
  classifyPrompts: z.boolean().optional(),
  /** Executor to be used for this environment. */
  executor: executorSchema
    .optional()
    .describe(
      'Executor to be used for this environment. ' +
        'If unset, a local executor is derived from the full environment configuration.',
    ),
});

/**
 * Shape of the object that configures an individual evaluation environment. Not intended to direct
 * reads, interact with the information through the `Environment` class.
 */
export type EnvironmentConfig = z.infer<typeof environmentConfigSchema> &
  Partial<LocalExecutorConfig>;

/** Package managers that are currently supported. */
export function getPossiblePackageManagers() {
  return ['npm', 'pnpm', 'yarn'] as const;
}

/** Asserts that the specified data is a valid environment config. */
export function assertIsEnvironmentConfig(value: unknown): asserts value is EnvironmentConfig {
  const validationResult = environmentConfigSchema
    .merge(
      // For backwards compatibility, users can directly configure the local executor
      // in the top-level environment configuration.
      localExecutorConfigSchema.partial(),
    )
    .safeParse(value);

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
