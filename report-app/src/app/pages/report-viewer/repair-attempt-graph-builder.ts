import {RunInfoFromReportServer} from '../../../../../runner/shared-interfaces';
import {BuildResultStatus} from '../../../../../runner/workers/builder/builder-types';
import {ScoreCssVariable} from '../../shared/scoring';
import {StackedBarChartData} from '../../shared/visualization/stacked-bar-chart/stacked-bar-chart';

/**
 * Calculates the average number of repair attempts performed in a run.
 */
export function calculateAverageRepairAttempts(report: RunInfoFromReportServer) {
  let totalRepairs = 0;
  let count = 0;

  for (const result of report.results) {
    // Only consider successful builds that required repairs.
    if (
      result.finalAttempt.buildResult.status === BuildResultStatus.SUCCESS &&
      result.repairAttempts > 0
    ) {
      totalRepairs += result.repairAttempts;
      count++;
    }
  }

  return count > 0 ? totalRepairs / count : null;
}

/**
 * Creates graph data for the "repair attempt" graph, from a given run report.
 */
export function createRepairAttemptGraphData(report: RunInfoFromReportServer) {
  const repairsToAppCount = new Map<number | 'failed', number>();

  // Map repair count to how many applications shared that count.
  let maxRepairCount = 0;
  for (const result of report.results) {
    if (result.finalAttempt.buildResult.status === BuildResultStatus.ERROR) {
      repairsToAppCount.set('failed', (repairsToAppCount.get('failed') || 0) + 1);
    } else {
      const repairs = result.repairAttempts;
      // For this graph, we ignore applications that required no repair.
      if (repairs > 0) {
        repairsToAppCount.set(repairs, (repairsToAppCount.get(repairs) || 0) + 1);
        maxRepairCount = Math.max(maxRepairCount, repairs);
      }
    }
  }

  const data: StackedBarChartData = [];

  // All the numeric keys, sorted by value.
  const intermediateRepairKeys = Array.from(repairsToAppCount.keys())
    .filter((k): k is number => typeof k === 'number')
    .sort((a, b) => a - b);

  // This graph might involve a bunch of sections. We want to scale them among all the possible color "grades".

  for (let repairCount = 1; repairCount <= maxRepairCount; repairCount++) {
    const applicationCount = repairsToAppCount.get(repairCount);
    if (!applicationCount) continue;

    data.push({
      label: labelByRepairCount(repairCount),
      color: colorByRepairCount(repairCount),
      value: applicationCount,
    });
  }

  // Handle 'Build failed even after all retries' - always maps to the "failure" grade.
  const failedCount = repairsToAppCount.get('failed') || 0;
  if (failedCount > 0) {
    data.push({
      label: 'Build failed even after all retries',
      color: ScoreCssVariable.poor,
      value: failedCount,
    });
  }
  return data;
}

function labelByRepairCount(repairCount: number): string {
  switch (repairCount) {
    case 1:
      return '1 repair';
    case 2:
    case 3:
    case 4:
      return `${repairCount} repairs`;
    default:
      return '5+ repairs';
  }
}

function colorByRepairCount(repairCount: number): string {
  // We're using mediocre1-5 since these are essentially *all* bad so we don't want green in this
  // graph.
  switch (repairCount) {
    case 1:
      return ScoreCssVariable.mediocre1;
    case 2:
      return ScoreCssVariable.mediocre2;
    case 3:
      return ScoreCssVariable.mediocre3;
    case 4:
      return ScoreCssVariable.mediocre4;
    default:
      return ScoreCssVariable.mediocre5;
  }
}
