import assert from 'assert';
import {RunGroup, RunInfo} from '../shared-interfaces.js';
import {groupSimilarReports} from '../orchestration/grouping.js';

/**
 * Takes a list of individual WCS reports and combines
 * them into a single WCS group with combined run.
 */
export function combineReports(
  runs: RunInfo[],
  groupId: string,
  runId: string,
): {
  group: RunGroup;
  runInfo: RunInfo;
} {
  assert.notEqual(runs.length, 0, 'Expected more than zero reports.');

  const combinedRuns = groupSimilarReports(
    runs.map(r => {
      return {...r, group: groupId} satisfies RunInfo;
    }),
  );
  assert.equal(combinedRuns.length, 1);

  const combinedRun = combinedRuns[0];
  const singleSampleRun = runs[0];
  const runInfo: RunInfo = {
    id: runId,
    group: combinedRun.id,
    results: runs.map(r => r.results).flat(),
    version: singleSampleRun.version,
    details: {
      reportName: singleSampleRun.details.reportName,
      summary: {
        displayName: singleSampleRun.details.summary.displayName,
        environmentId: singleSampleRun.details.summary.environmentId,
        framework: singleSampleRun.details.summary.framework,
        model: singleSampleRun.details.summary.model,
        usage: singleSampleRun.details.summary.usage,
      },
      systemPromptGeneration: '',
      systemPromptRepair: '',
      timestamp: singleSampleRun.details.timestamp,
    },
  };

  return {
    group: combinedRun,
    runInfo,
  };
}
