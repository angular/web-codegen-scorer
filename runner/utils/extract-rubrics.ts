import {AssessmentResult, IndividualAssessmentState} from '../shared-interfaces.js';

export interface RubricInfo {
  score: number;
}

export function extractRubrics(results: AssessmentResult[]): Record<string, RubricInfo> {
  const rubricsBreakdown: Record<string, number[]> = {};

  for (const app of results) {
    const rubricsAnalysis: Record<string, {scores: {value: number; weight: number}[]}> = {};

    for (const category of app.score.categories) {
      for (const check of category.assessments) {
        if (check.state === IndividualAssessmentState.SKIPPED) {
          continue;
        }

        for (const label of check.groupingLabels ?? []) {
          if (!rubricsAnalysis[label]) {
            rubricsAnalysis[label] = {scores: []};
          }

          const checkWeightWithPillar =
            category.maxPoints * (parseFloat(check.scoreReduction) / 100);

          rubricsAnalysis[label]!.scores.push({
            value: checkWeightWithPillar * check.successPercentage,
            weight: checkWeightWithPillar,
          });
        }
      }
    }

    for (const label in rubricsAnalysis) {
      const scores = rubricsAnalysis[label]!.scores;
      const numerator = scores.reduce((sum, score) => sum + score.value, 0);
      const denominator = scores.reduce((sum, score) => sum + score.weight, 0);

      rubricsBreakdown[label] ??= [];
      rubricsBreakdown[label].push(numerator / denominator);
    }
  }

  return Object.entries(rubricsBreakdown).reduce(
    (rubricsResult, [label, scores]) => ({
      ...rubricsResult,
      [label]: scores.reduce((prev, cur) => prev + cur, 0) / scores.length,
    }),
    {},
  );
}
