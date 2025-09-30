import {PerBuildRating, RatingCategory, RatingKind, RatingState} from '../rating-types.js';

/**
 * A rating that assesses the code based on SafetyWeb violations found.
 */
export const safetyWebRating: PerBuildRating = {
  kind: RatingKind.PER_BUILD,
  name: 'SafetyWeb Violations',
  description: 'Checks for TrustedTypes and CSP incompatible coding patterns.',
  category: RatingCategory.HIGH_IMPACT,
  id: 'safety-web',
  scoreReduction: '50%',
  rate: ({buildResult}) => {
    // There should only be one package-- the generated app.
    const violations = buildResult.safetyWebReportJson?.[0]?.violations;

    if (violations === undefined) {
      return {
        state: RatingState.SKIPPED,
        message: 'SafetyWeb testing was not performed.',
      };
    }

    if (violations.length === 0) {
      return {
        state: RatingState.EXECUTED,
        coefficient: 1,
        message: 'No safety-web violations found.',
      };
    }

    // Subtract from a starting coefficient of 1 based on the impact of each violation.
    let coefficient = 1.0 - violations.length * 0.1;

    const formattedViolations = violations.map((v, i) => v.ruleId + ' - ').join('\n\n');
    const message = `Found ${violations.length} safety-web violations:\n\n${formattedViolations}`;

    return {
      state: RatingState.EXECUTED,
      // Ensure the coefficient does not go below 0.
      coefficient: Math.max(0, coefficient),
      message,
    };
  },
};
