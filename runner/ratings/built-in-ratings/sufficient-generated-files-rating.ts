import {PerBuildRating, RatingCategory, RatingKind, RatingState} from '../rating-types.js';

/** Rating which verifies that the LLM produced at least one file. */
export const sufficientGeneratedFilesRating: PerBuildRating = {
  name: 'Sufficient number of generated files',
  description: 'Ensures that the LLM produced at least one file.',
  category: RatingCategory.HIGH_IMPACT,
  id: 'common-generated-file-count',
  scoreReduction: '100%',
  kind: RatingKind.PER_BUILD,
  rate: ({generatedFileCount}) => ({
    state: RatingState.EXECUTED,
    coefficient: generatedFileCount > 0 ? 1 : 0,
  }),
};
