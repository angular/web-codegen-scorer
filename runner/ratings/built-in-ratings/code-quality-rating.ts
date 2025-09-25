import { autoRateCode } from '../autoraters/code-rater.js';
import {
  LLMBasedRating,
  RatingKind,
  RatingCategory,
  RatingState,
} from '../rating-types.js';

/** Rating that verifies the generated code quality using an LLM. */
export const codeQualityRating: LLMBasedRating = {
  kind: RatingKind.LLM_BASED,
  name: 'Code Quality (LLM-rated)',
  description: `Rates the app's source code via LLM`,
  category: RatingCategory.MEDIUM_IMPACT,
  id: 'common-autorater-code-quality',
  scoreReduction: '30%',
  rate: async (ctx) => {
    const { coefficient, usage, details } = await autoRateCode(
      ctx.llm,
      ctx.abortSignal,
      ctx.model,
      ctx.environment,
      ctx.outputFiles,
      ctx.fullPromptText,
      ctx.ratingsContext
    );

    return {
      state: RatingState.EXECUTED,
      coefficient,
      tokenUsage: usage,
      details,
    };
  },
};
