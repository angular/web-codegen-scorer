import {
  PerFileRating,
  PerFileRatingContentType,
  RatingCategory,
  RatingKind,
} from '../rating-types.js';

/** Rating that verifies that the LLM didn't generate empty files. */
export const sufficientCodeSizeRating: PerFileRating = {
  name: 'Sufficient Code Size (over 50b)',
  description: 'Ensures the generated code is not trivially small (e.g. < 50b).',
  category: RatingCategory.HIGH_IMPACT,
  id: 'common-generated-code-size',
  scoreReduction: '30%',
  kind: RatingKind.PER_FILE,
  rate: (code, _filePath) => (code.length > 50 ? 1 : 0),
  filter: {
    // Only check TS/HTML since styles might not be necessary in all cases.
    pathPattern: /\.(ts|tsx|html)/,
    type: PerFileRatingContentType.UNKNOWN,
  },
};
