import z from 'zod';
import {BuildResult} from '../workers/builder/builder-types.js';
import type {
  IndividualAssessment,
  LlmResponseFile,
  PromptDefinition,
  SkippedIndividualAssessment,
  TestExecutionResult,
  Usage,
} from '../shared-interfaces.js';
import {Environment} from '../configuration/environment.js';
import {ServeTestingResult} from '../workers/serve-testing/worker-types.js';
import {AiSdkRunner} from '../codegen/ai-sdk/ai-sdk-runner.js';

/** Possible types of ratings. */
export enum RatingKind {
  PER_BUILD,
  PER_FILE,
  LLM_BASED,
}

/** Enum for the state of a rating. */
export enum RatingState {
  EXECUTED,
  SKIPPED,
}

/** Categories that can be assigned to a rating. */
export enum RatingCategory {
  HIGH_IMPACT = 'high-impact',
  MEDIUM_IMPACT = 'medium-impact',
  LOW_IMPACT = 'low-impact',
}

const ratingCommonContextFields = {
  ratingsResult: z.record(z.custom<IndividualAssessment | SkippedIndividualAssessment>()),
  prompt: z.custom<PromptDefinition>(),
};

const ratingSchemaCommonFields = {
  category: z.custom<RatingCategory>(),
  scoreReduction: z.custom<`${number}%`>(),
  name: z.string(),
  description: z.string(),
  id: z.string(),
  groupingLabels: z.array(z.string()).optional(),
} as const;

const perBuildRatingSchema = z
  .object({
    ...ratingSchemaCommonFields,
    kind: z.literal(RatingKind.PER_BUILD),
    rate: z
      .function()
      .args(
        z.strictObject({
          buildResult: z.custom<BuildResult>(),
          generatedFiles: z.custom<LlmResponseFile[]>(),
          serveResult: z.custom<ServeTestingResult | null>(),
          repairAttempts: z.number(),
          testResult: z.custom<TestExecutionResult | null>(),
          testRepairAttempts: z.number(),
          axeRepairAttempts: z.number(),
          ...ratingCommonContextFields,
        }),
      )
      .returns(z.custom<PerBuildRatingResult>()),
  })
  .describe('PerBuildRating');

const perFileRatingSchema = z
  .object({
    ...ratingSchemaCommonFields,
    kind: z.literal(RatingKind.PER_FILE),
    rate: z
      .function()
      .args(
        z.string().describe('Code'),
        z.string().optional().describe('File path'),
        z.object(ratingCommonContextFields).describe('Context'),
      )
      .returns(z.custom<PerFileRatingResult>()),
    filter: z.union([
      z
        .custom<PerFileRatingContentType>(value => typeof value === 'number')
        .describe('PerFileRatingContentType'),
      z.strictObject({
        type: z
          .custom<PerFileRatingContentType>(value => typeof value === 'number')
          .describe('PerFileRatingContentType'),
        pattern: z.custom<RegExp>(data => data instanceof RegExp).optional(),
        pathPattern: z.custom<RegExp>(data => data instanceof RegExp).optional(),
      }),
    ]),
  })
  .describe('PerFileRating');

const llmBasedRatingSchema = z
  .object({
    ...ratingSchemaCommonFields,
    kind: z.literal(RatingKind.LLM_BASED),
    rate: z
      .function()
      .args(z.custom<LLMBasedRatingContext>())
      .returns(z.custom<LLMBasedRatingResult>()),
  })
  .describe('LLMBasedRating');

export const ratingSchema = z.union([
  perBuildRatingSchema,
  perFileRatingSchema,
  llmBasedRatingSchema,
]);

export const ratingOverrideSchema = z.object({
  category: z.custom<RatingCategory>().optional(),
  scoreReduction: z.custom<`${number}%`>().optional(),
  groupingLabels: z.array(z.string()).optional().optional(),
});

/** Result of a per-build rating. */
export type PerBuildRatingResult =
  | {
      state: RatingState.EXECUTED;
      coefficient: number;
      message?: string;
    }
  | {
      state: RatingState.SKIPPED;
      message: string;
    };

export type PerFileRatingResult =
  | number
  | {
      rating: number;
      errorMessage: string;
    }
  | Promise<
      | number
      | {
          rating: number;
          errorMessage: string;
        }
    >;

export type LLMBasedRatingResult = Promise<
  | ExecutedLLMBasedRating
  | {
      state: RatingState.SKIPPED;
      message: string;
    }
>;

/** Types of content that a specific rating can run against. */
export enum PerFileRatingContentType {
  /** Only runs against TypeScript code. */
  TS,
  /** Only runs against CSS code. */
  CSS,
  /** Only runs against HTML code. */
  HTML,
  /** Runs against any sort of code. */
  UNKNOWN,
}

export interface ExecutedLLMBasedRating {
  state: RatingState.EXECUTED;
  coefficient: number;
  message?: string;
  tokenUsage: Usage;
  details: {
    summary: string;
    categories: {name: string; message: string}[];
  };
}

export type RatingsResult = Record<string, IndividualAssessment | SkippedIndividualAssessment>;

export interface LLMBasedRatingContext {
  environment: Environment;
  fullPromptText: string;
  currentPromptDef: PromptDefinition;
  llm: AiSdkRunner;
  model: string;
  outputFiles: LlmResponseFile[];
  buildResult: BuildResult;
  serveTestingResult: ServeTestingResult | null;
  repairAttempts: number;
  axeRepairAttempts: number;
  abortSignal: AbortSignal;
  ratingsResult: RatingsResult;
}

/** Rating that applies over build results. */
export type PerBuildRating = z.infer<typeof perBuildRatingSchema>;

/** Rating that applies over individual files. */
export type PerFileRating = z.infer<typeof perFileRatingSchema>;

/** Rating that goes through an LLM to produce a result. */
export type LLMBasedRating = z.infer<typeof llmBasedRatingSchema>;

/** Union of all available ratings. */
export type Rating = z.infer<typeof ratingSchema>;
