import {
  PerBuildRating,
  RatingCategory,
  RatingKind,
  RatingState,
} from '../rating-types.js';
import { CspViolation } from '../../workers/serve-testing/auto-csp-types.js';

/**
 * Formats an array of CSP violations into a readable string for the report.
 * @param violations Array of violations to format.
 * @returns A formatted string detailing the violations.
 */
function formatViolations(violations: CspViolation[]): string {
  if (!violations || violations.length === 0) {
    return '';
  }
  return violations
    .map(
      (v) =>
        `- Violated Directive: ${v['violated-directive']}
` +
        `  Source File: ${v['source-file']}:${v['line-number']}
` +
        `  Blocked URI: ${v['blocked-uri'] || 'N/A'}
` +
        `  Code Snippet:
---
${v.codeSnippet || v['script-sample'] || 'Not available'}
---
`
    )
    .join('\n\n');
}

/**
 * Rating that checks for general Content Security Policy violations,
 * excluding those related to Trusted Types.
 */
export const cspViolationsRating: PerBuildRating = {
  kind: RatingKind.PER_BUILD,
  name: 'CSP Violations',
  description:
    'Checks for Content Security Policy violations, excluding Trusted Types.',
  id: 'csp-violations',
  category: RatingCategory.HIGH_IMPACT,
  scoreReduction: '50%',
  rate: ({ serveResult }) => {
    if (!serveResult?.cspViolations) {
      return {
        state: RatingState.SKIPPED,
        message: 'CSP violation data not available for this run.',
      };
    }

    const violations = serveResult.cspViolations?.filter(
      (v) => v['violated-directive'] !== 'require-trusted-types-for'
    );
    if (!violations || violations.length === 0) {
      return {
        state: RatingState.EXECUTED,
        coefficient: 1,
        message: 'No CSP violations found.',
      };
    }

    const message = `Found ${violations.length} CSP violations:\n\n${formatViolations(violations)}`;

    return {
      state: RatingState.EXECUTED,
      coefficient: 0,
      message,
    };
  },
};

/**
 * Rating that specifically checks for violations of the
 * 'require-trusted-types-for' CSP directive.
 */
export const trustedTypesViolationsRating: PerBuildRating = {
  kind: RatingKind.PER_BUILD,
  name: 'Trusted Types Violations',
  description: 'Checks for Trusted Types violations specifically.',
  id: 'trusted-types-violations',
  category: RatingCategory.HIGH_IMPACT,
  scoreReduction: '50%',
  rate: ({ serveResult }) => {
    if (!serveResult?.cspViolations) {
      return {
        state: RatingState.SKIPPED,
        message: 'Trusted Types violation data not available for this run.',
      };
    }

    const violations = serveResult?.cspViolations?.filter(
      (v) => v['violated-directive'] === 'require-trusted-types-for'
    );

    if (!violations || violations.length === 0) {
      return {
        state: RatingState.EXECUTED,
        coefficient: 1,
        message: 'No Trusted Types violations found.',
      };
    }

    const message = `Found ${violations.length} Trusted Types violations:\n\n${formatViolations(violations)}`;

    return {
      state: RatingState.EXECUTED,
      coefficient: 0,
      message,
    };
  },
};
