import {
  PerBuildRating,
  RatingKind,
  RatingCategory,
  RatingState,
} from '../rating-types.js';

/** Rating that verifies the interactivity of the generated app. */
export const userJourneysRating: PerBuildRating = {
  id: 'user-journey-tests',
  name: 'User Journey validation',
  description:
    'Ensures that all User Journeys are working in the generated app',
  kind: RatingKind.PER_BUILD,
  category: RatingCategory.MEDIUM_IMPACT,
  scoreReduction: '30%',
  rate: ({ serveResult }) => {
    if (serveResult === null || serveResult.userJourneyAgentOutput === null) {
      return {
        state: RatingState.SKIPPED,
        message: 'Was not enabled for this run',
      };
    }

    const output = serveResult.userJourneyAgentOutput;
    if (output.errors !== undefined) {
      return {
        coefficient: 0,
        state: RatingState.EXECUTED,
        message: `Execution error: ${output.errors.join('\n')}`,
      };
    }

    // TODO: Investigate this.
    if (output.analysis.length === 0) {
      return {
        coefficient: 0,
        state: RatingState.EXECUTED,
        message: `Result is empty.`,
      };
    }

    const failingCount = output.analysis.filter((c) => c.passing).length;
    const percentagePassing = failingCount / output.analysis.length;

    let message: string;
    if (percentagePassing === 1) {
      message = `All validations passed.\n${output.analysis.map((c) => `- ${c.journey}`).join('\n')}`;
    } else {
      const failureMsg = output.analysis
        .map(
          (c) =>
            `- ${c.journey}${
              c.passing
                ? ''
                : `(Failing)\n
Expected: ${c.failure?.expected}
Observed: ${c.failure?.observed}`
            }`
        )
        .join('\n');
      message = `${failingCount}/${output.analysis.length} passed.\n${failureMsg}`;
    }

    // TODO: Implement.
    return {
      state: RatingState.EXECUTED,
      coefficient: percentagePassing,
      message,
    };
  },
};
