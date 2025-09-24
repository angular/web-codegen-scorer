import { Result } from 'axe-core';
import {
  PerBuildRating,
  RatingCategory,
  RatingKind,
  RatingState,
} from '../rating-types.js';

// Define the scoring weights for each violation impact level as a coefficient penalty.
const IMPACT_COEFFICIENTS = {
  critical: 1.0,
  serious: 0.75,
  moderate: 0.5,
  minor: 0.25,
};

const REPAIR_ATTEMPT_PENALTY = 0.5;
const FAILED_REPAIR_PENALTY = 0.5;

/**
 * A rating that assesses the code based on Axe accessibility violations.
 */
export const axeRating: PerBuildRating = {
  kind: RatingKind.PER_BUILD,
  name: 'Axe Accessibility Violations',
  description: 'Checks for accessibility violations using the Axe-core engine.',
  category: RatingCategory.MEDIUM_IMPACT,
  id: 'axe-a11y',
  scoreReduction: '10%',
  rate: ({ serveResult, axeRepairAttempts }) => {
    const violations = serveResult?.axeViolations as Result[] | undefined;
    // Start with a perfect score.
    let coefficient = 1.0;
    let message: string = '';

    if (violations === undefined) {
      return {
        state: RatingState.SKIPPED,
        message: 'Axe testing was not performed.',
      };
    }

    if (violations.length === 0) {
      message += 'No accessibility violations found.';
    } else {
      for (const violation of violations) {
        coefficient -= IMPACT_COEFFICIENTS[violation.impact!] ?? 0;
      }

      const formattedViolations = violations
        .map((v, i) => formatAxeViolation(v, i, violations.length))
        .join('\n\n');
      message += `Found ${
        violations.length
      } accessibility violations:\n\n${formattedViolations}`;
    }

    // Apply penalties for repair attempts.
    if (axeRepairAttempts > 0) {
      message += `\nAxe Repair Attempts: ${axeRepairAttempts} attempt(s)`;
      coefficient -= axeRepairAttempts * REPAIR_ATTEMPT_PENALTY;
      // Apply an additional penalty if violations still exist after repairs.
      if (violations.length > 0) {
        coefficient -= FAILED_REPAIR_PENALTY;
      }
    }

    return {
      state: RatingState.EXECUTED,
      // Ensure the coefficient does not go below 0.
      coefficient: Math.max(0, coefficient),
      message,
    };
  },
};

/**
 * Formats a single Axe violation into a more concise, readable string.
 */
function formatAxeViolation(
  violation: Result,
  index: number,
  total: number
): string {
  // Consolidate all violating selectors into a single line for brevity.
  const violationNum = total > 1 ? `${index + 1}.` : '';
  const firstNodeHtml = violation.nodes[0]?.html;

  // Use \n for newlines. The report viewer's CSS will handle the line breaks.
  let message = `${violationNum} Violation: ${violation.id} | Impact: ${violation.impact}
  - Description: ${violation.description}.`;

  if (firstNodeHtml) {
    message += `\n  - HTML: ${firstNodeHtml.substring(0, 150)}`;
  }

  return message;
}
