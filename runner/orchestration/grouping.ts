import { createHash } from 'crypto';
import type { LlmRunner } from '../codegen/llm-runner.js';
import type { Environment } from '../configuration/environment.js';
import { calculateBuildAndCheckStats } from '../ratings/stats.js';
import type {
  AssessmentResult,
  RunGroup,
  RunInfo,
} from '../shared-interfaces.js';
import { RunnerName } from '../codegen/runner-creation.js';

/** Generates a unique grouping ID for a run. */
export function getRunGroupId(
  timestamp: Date,
  env: Environment,
  options: {
    runner: RunnerName;
    model: string;
    labels?: string[];
  }
): string {
  const dateOnly = new Date(
    timestamp.getFullYear(),
    timestamp.getMonth(),
    timestamp.getDate(),
    0,
    0,
    0
  );

  // We use this as a key to group identical reports together.
  const group =
    `${dateOnly.toLocaleDateString()}/${env.id}/` +
    `${options.labels?.sort().join('/')}/${options.model}/${options.runner}`;

  // The group string above can get long. Hash it to something shorter and fixed length.
  return createHash('sha256').update(group).digest('hex');
}

/**
 * Groups runs based on their group ID and summarizes the information
 * between the identical runs. Useful for displaying lists of runs.
 */
export function groupSimilarReports(inputRuns: RunInfo[]): RunGroup[] {
  const groups: RunGroup[] = [];
  const groupedRuns = new Map<string, RunInfo[]>();

  // Split up the runs in groups first.
  for (const run of inputRuns) {
    if (groupedRuns.has(run.group)) {
      groupedRuns.get(run.group)!.push(run);
    } else {
      groupedRuns.set(run.group, [run]);
    }
  }

  // Afterwards create the actual groups.
  // We need two separate steps, because some of the scores are averages.
  for (const [id, groupRuns] of groupedRuns) {
    const groupResults: AssessmentResult[] = [];
    const firstRun = groupRuns[0];
    const labels = new Set<string>();
    let totalForGroup = 0;
    let maxForGroup = 0;
    let appsCount = 0;

    // Average out the scores.
    for (const run of groupRuns) {
      let totalForRun = 0;
      let maxForRun = 0;

      run.details.labels?.forEach((label) => labels.add(label));

      for (const result of run.results) {
        totalForRun += result.score.totalPoints;
        maxForRun += result.score.maxOverallPoints;
        groupResults.push(result);
      }

      // `|| 0` in case there are no results, otherwise we'll get NaN.
      totalForGroup += totalForRun / run.results.length || 0;
      maxForGroup += maxForRun / run.results.length || 0;
      appsCount += run.results.length;
    }

    groups.push({
      id,
      // The display information is identical between all
      // the runs so take the one from the first run.
      version: firstRun.version!,
      displayName: firstRun.details.summary.displayName,
      timestamp: firstRun.details.timestamp,
      // `|| 0` in case there are no results, otherwise we'll get NaN.
      totalPoints: totalForGroup / groupRuns.length || 0,
      maxOverallPoints: maxForGroup / groupRuns.length || 0,
      appsCount,
      labels: Array.from(labels),
      environmentId: firstRun.details.summary.environmentId,
      framework: firstRun.details.summary.framework,
      model: firstRun.details.summary.model,
      stats: calculateBuildAndCheckStats(groupResults),
      runner: firstRun.details.summary.runner,
    });
  }

  return groups;
}
