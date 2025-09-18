import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { RunGroup, RunInfo } from '../shared-interfaces.js';
import { glob } from 'tinyglobby';

/** Type describing a map from group report IDs to their runs. */
export type FetchedLocalReports = Map<
  /* groupId */ string,
  {
    group: RunGroup;
    run: RunInfo;
  }
>;

/** Fetches local report data from the given directory. */
export async function fetchReportsFromDisk(
  directory: string
): Promise<FetchedLocalReports> {
  const data: FetchedLocalReports = new Map();
  const groupFiles = await glob('**/groups.json', {
    cwd: directory,
    absolute: true,
  });

  await Promise.all(
    // Note: sort the groups so that the indexes stay consistent no matter how the files
    // appear on disk. It appears to be non-deterministic when using the async glob.
    groupFiles.sort().map(async (configPath, index) => {
      const [groupContent, runContent] = await Promise.all([
        readFile(configPath, 'utf8'),
        readFile(join(dirname(configPath), 'summary.json'), 'utf8'),
      ]);

      // Note: Local reports only have one group.
      const group = (JSON.parse(groupContent) as RunGroup[])[0];
      const run = JSON.parse(runContent) as RunInfo;

      // Local runs should not be grouped by their group ID, but rather if they
      // were part of the same invocation. Add a unique suffix to the ID to
      // prevent further grouping.
      run.group = group.id = `${group.id}-l${index}`;
      data.set(group.id, { group, run });
    })
  );

  return data;
}
