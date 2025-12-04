import z from 'zod';
import {createMessageBuilder, fromError} from 'zod-validation-error/v3';
import {UserFacingError} from '../utils/errors.js';
import {RatingCategory, ratingOverrideSchema, ratingSchema} from '../ratings/rating-types.js';
import {EvalPrompt, EvalPromptWithMetadata, MultiStepPrompt} from './prompts.js';
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
  /**
   * Map used to override fields for specific ratings. The key is the unique ID of
   * the rating and the value are the override fields.
   */
  ratingOverrides: z.record(z.string(), ratingOverrideSchema).optional(),
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
      z.custom<EvalPrompt>(data => data instanceof EvalPrompt),
      z.custom<EvalPromptWithMetadata<unknown>>(data => data instanceof EvalPromptWithMetadata),
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
  /**
   * Timeout in minutes for a single prompt evaluation.
   *
   * E.g. if a single app takes longer than 10min, it will be aborted.
   */
  promptTimeoutMinutes: z.number().optional(),
  /** Executor to be used for this environment. */
  executor: executorSchema
    .optional()
    .describe(
      'Executor to be used for this environment. ' +
        'If unset, a local executor is derived from the full environment configuration.',
    ),

  /**
   * Map used to override fields for specific rating categories. The key is the unique ID of
   * the category and the value are the override fields.
   */
  categoryOverrides: z
    .record(
      z.custom<RatingCategory>(),
      z.object({
        name: z.string().optional(),
        maxPoints: z.number().optional(),
      }),
    )
    .optional(),

  /**
   * When an environment is created, it generates a hash based on the configured ratings.
   * This field is used to validate that the generated hash matches a pre-defined one.
   * It's useful to ensure that the set of ratings hasn't changed between two runs.
   */
  expectedRatingHash: z.string().optional(),
});

/**
 * Shape of the object that configures an individual evaluation environment. Not intended to direct
 * reads, interact with the information through the `Environment` class.
 */
export type EnvironmentConfig = z.infer<typeof environmentConfigSchema> &
  Partial<LocalExecutorConfig>;

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
