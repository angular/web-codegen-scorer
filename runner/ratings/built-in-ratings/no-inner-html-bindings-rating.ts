import {
  PerFileRating,
  PerFileRatingContentType,
  RatingCategory,
  RatingKind,
} from '../rating-types.js';

const RATING_NAME = 'No-Inner-HTML-Bindings';
const RATING_DESCRIPTION =
  "Checks that no templates contain bindings that bypass sanitization, like Angular's `[innerHTML]`.";

const ANGULAR_BINDING_REGEX = /\[(innerHTML|outerHTML|srcdoc)\]/g;

export const NoInnerHtmlBindingsRating: PerFileRating = {
  kind: RatingKind.PER_FILE,
  name: RATING_NAME,
  id: 'no-inner-html-bindings',
  category: RatingCategory.MEDIUM_IMPACT,
  scoreReduction: '50%',
  description: RATING_DESCRIPTION,
  filter: {
    type: PerFileRatingContentType.HTML,
  },
  rate: async (code, filePath) => {
    const matches = [...code.matchAll(ANGULAR_BINDING_REGEX)];
    if (matches.length > 0) {
      const violations = matches.map(match => `Binding to "[${match[1]}]"`);
      return {
        rating: 0,
        errorMessage: `Found security vulnerabilities in ${filePath}:\n- ${violations.join('\n- ')}`,
      };
    }
    return 1;
  },
};
