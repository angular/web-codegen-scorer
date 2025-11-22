import {PerBuildRating, RatingCategory, RatingKind, RatingState} from '../rating-types.js';

/** Rating which verifies that the LLM produced at least one file. */
export const sufficientGeneratedFilesRating: PerBuildRating = {
  name: 'Sufficient number of generated files',
  description: 'Ensures that the LLM produced at least one file.',
  category: RatingCategory.HIGH_IMPACT,
  groupingLabels: ['sufficient-code-checks'],
  id: 'common-generated-file-count',
  scoreReduction: '100%',
  kind: RatingKind.PER_BUILD,
  rate: ({generatedFiles}) => ({
    state: RatingState.EXECUTED,
    coefficient: generatedFiles.length > 0 ? 1 : 0,
  }),
};
