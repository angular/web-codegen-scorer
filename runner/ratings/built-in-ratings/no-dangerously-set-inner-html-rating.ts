import {
  PerFileRating,
  PerFileRatingContentType,
  RatingCategory,
  RatingKind,
} from '../rating-types.js';

const RATING_NAME = 'No-Dangerously-Set-Inner-HTML';
const RATING_DESCRIPTION =
  "Checks that no templates contain bindings that bypass sanitization, like React's `dangerouslySetInnerHTML`.";

const REACT_DANGEROUS_HTML_REGEX = /dangerouslySetInnerHTML/g;

export const NoDangerouslySetInnerHtmlRating: PerFileRating = {
  kind: RatingKind.PER_FILE,
  name: RATING_NAME,
  id: 'no-dangerously-set-inner-html',
  category: RatingCategory.MEDIUM_IMPACT,
  groupingLabels: ['security'],
  scoreReduction: '50%',
  description: RATING_DESCRIPTION,
  filter: {
    pathPattern: /\.(tsx|jsx)$/,
    type: PerFileRatingContentType.UNKNOWN,
  },
  rate: async (code, filePath) => {
    const matches = [...code.matchAll(REACT_DANGEROUS_HTML_REGEX)];

    if (matches.length > 0) {
      return {
        rating: 0,
        errorMessage: `Found security vulnerabilities in ${filePath}:\n- \"dangerouslySetInnerHTML\"`,
      };
    }

    return 1;
  },
};
