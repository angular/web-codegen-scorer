import { TimeoutError } from 'puppeteer';
import { AutoRateResult } from '../autoraters/auto-rate-shared.js';
import { autoRateAppearance } from '../autoraters/visuals-rater.js';
import {
  LLMBasedRating,
  RatingKind,
  RatingCategory,
  RatingState,
} from '../rating-types.js';

/** Rating which verifies the appearance of the generated app using an LLM. */
export const visualAppearanceRating: LLMBasedRating = {
  kind: RatingKind.LLM_BASED,
  name: 'UI & Visual appearance (LLM-Rated)',
  description:
    'Rates the app based on its visuals (UI visuals and feature completeness).',
  category: RatingCategory.MEDIUM_IMPACT,
  scoreReduction: '30%',
  id: 'common-autorater-visuals',
  rate: async (ctx) => {
    if (ctx.buildResult.screenshotPngUrl === undefined) {
      return {
        state: RatingState.SKIPPED,
        message: 'No screenshot available',
      };
    }

    let result: AutoRateResult;

    try {
      result = await autoRateAppearance(
        ctx.llm,
        ctx.abortSignal,
        ctx.model,
        ctx.environment,
        ctx.fullPromptText,
        ctx.buildResult.screenshotPngUrl,
        ctx.currentPromptDef.name
      );
    } catch (e) {
      if (e instanceof TimeoutError) {
        return {
          state: RatingState.SKIPPED,
          message: `LLM request timed out for ${ctx.currentPromptDef.name} using ${ctx.model}.`,
        };
      }
      throw e;
    }

    return {
      state: RatingState.EXECUTED,
      coefficient: result.coefficient,
      tokenUsage: result.usage,
      details: result.details,
    };
  },
};
