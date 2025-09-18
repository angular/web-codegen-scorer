import stylelint from 'stylelint';
import {
  PerFileRating,
  RatingCategory,
  RatingKind,
  PerFileRatingContentType,
} from '../rating-types.js';

/** Rating which verifies that the generated CSS is valid. */
export const validCssRating: PerFileRating = {
  name: 'Valid CSS',
  description: 'Ensures that the generated CSS code is valid',
  category: RatingCategory.MEDIUM_IMPACT,
  scoreReduction: '20%',
  kind: RatingKind.PER_FILE,
  id: 'common-valid-css',
  filter: PerFileRatingContentType.CSS,
  rate: async (code) => {
    const linterResult = await stylelint.lint({
      code: code,
      cwd: import.meta.dirname,
      config: {
        extends: ['stylelint-config-recommended-scss'],
        defaultSeverity: 'warning',
        rules: {
          'selector-pseudo-element-no-unknown': [
            true,
            {
              ignorePseudoElements: ['ng-deep'],
            },
          ],
          'no-descending-specificity': null,
          'function-linear-gradient-no-nonstandard-direction': null,
          'declaration-property-value-keyword-no-deprecated': null,
          // In some cases external styles might not be necessary.
          'no-empty-source': null,
          // Tailwind uses a variety of custom at-rules that the linter doesn't know about.
          'at-rule-no-unknown': null,
          'at-rule-no-deprecated': null,
          'scss/at-rule-no-unknown': null,
        },
      },
      formatter: 'compact',
    });

    if (linterResult.errored) {
      // A syntax error results in a failure.
      return {
        rating: 0,
        errorMessage: linterResult.report,
      };
    }

    // One file processed produces one result.
    const lintResult = linterResult.results[0];
    const warningCount =
      lintResult.warnings.length + lintResult.deprecations.length;

    if (warningCount == 0) {
      return 1;
    }

    return {
      rating: Math.max(1 - warningCount * 0.1, 0),
      errorMessage: linterResult.report,
    };
  },
};
