import { BuildResultStatus } from '../../workers/builder/builder-types.js';
import {
  PerBuildRating,
  RatingKind,
  RatingCategory,
  RatingState,
} from '../rating-types.js';

/** Rating which verifies that there are no runtime errors. */
export const noRuntimeExceptionsRating: PerBuildRating = {
  name: 'No runtime exceptions',
  description: "Ensures the app doesn't have runtime exceptions.",
  kind: RatingKind.PER_BUILD,
  category: RatingCategory.HIGH_IMPACT,
  scoreReduction: '50%',
  id: 'common-no-runtime-errors',
  rate: ({ buildResult, serveResult }) => ({
    state: RatingState.EXECUTED,
    coefficient:
      // If we can't build - we can't run it as well.
      buildResult.status === BuildResultStatus.ERROR ||
      // If we couldn't serve, then it can't run as well.
      serveResult === null ||
      serveResult.errorMessage !== undefined ||
      // If there are actual runtime errors:
      !!serveResult.runtimeErrors
        ? 0
        : 1,
  }),
};
