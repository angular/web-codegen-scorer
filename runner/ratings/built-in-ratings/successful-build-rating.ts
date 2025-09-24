import { BuildResultStatus } from '../../workers/builder/builder-types.js';
import {
  PerBuildRating,
  RatingKind,
  RatingCategory,
  RatingState,
} from '../rating-types.js';

/** Rating which verifies that the application builds successfully. */
export const successfulBuildRating: PerBuildRating = {
  name: 'Code builds successfully',
  description: 'Ensures the code build without errors.',
  id: 'common-successful-build',
  kind: RatingKind.PER_BUILD,
  category: RatingCategory.HIGH_IMPACT,
  scoreReduction: '50%',
  // Reduce the amount of points in case we've built the code with a few repair attempts.
  rate: ({ buildResult, repairAttempts }) => ({
    state: RatingState.EXECUTED,
    coefficient:
      buildResult.status === BuildResultStatus.ERROR
        ? 0
        : 1 / (repairAttempts + 1),
  }),
};
