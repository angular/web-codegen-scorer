import {PerBuildRating, RatingKind, RatingCategory, RatingState} from '../rating-types.js';

/** Rating which verifies that unit tests pass successfully. */
export const successfulTestsRating: PerBuildRating = {
  name: 'Tests pass successfully',
  description: 'Ensures tests run and pass without errors.',
  id: 'common-successful-tests',
  kind: RatingKind.PER_BUILD,
  category: RatingCategory.MEDIUM_IMPACT,
  scoreReduction: '30%',
  // Reduce the amount of points in case we've had test repair attempts.
  rate: ({testResult, testRepairAttempts}) => {
    // If no test results are available, skip this rating
    if (!testResult) {
      return {
        state: RatingState.SKIPPED,
        message: 'Unit testing not configured.',
      };
    }

    return {
      state: RatingState.EXECUTED,
      coefficient: testResult.passed
        ? 1 / ((testRepairAttempts || 0) + 1) // Reduce score based on repair attempts
        : 0, // No points if tests failed
    };
  },
};
