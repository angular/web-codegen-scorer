import {IndividualAssessmentState, RunInfo} from '../shared-interfaces.js';

export interface RubricInfo {
  score: number;
}

export function extractRubrics(run: RunInfo): Record<string, RubricInfo> {
  const rubricsAnalysis: Record<string, {scores: {value: number; weight: number}[]}> = {};

  for (const app of run.results) {
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
  }

  const rubricsBreakdown: Record<string, RubricInfo> = {};
  for (const label in rubricsAnalysis) {
    const scores = rubricsAnalysis[label]!.scores;
    const numerator = scores.reduce((sum, score) => sum + score.value, 0);
    const denominator = scores.reduce((sum, score) => sum + score.weight, 0);
    rubricsBreakdown[label] = {
      score: numerator / denominator,
    };
  }
  return rubricsBreakdown;
}
