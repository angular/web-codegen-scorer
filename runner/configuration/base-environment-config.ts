import z from 'zod';
import { ratingSchema } from '../ratings/rating-types.js';
import { MultiStepPrompt } from './multi-step-prompt.js';
import { mcpServerOptionsSchema } from '../codegen/llm-runner.js';
import { getPossiblePackageManagers } from './environment-config.js';

export const baseEnvironmentConfigSchema = z.strictObject({
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
      z.custom<MultiStepPrompt>((data) => data instanceof MultiStepPrompt),
    ])
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
});
