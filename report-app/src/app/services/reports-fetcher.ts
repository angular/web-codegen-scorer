import {
  computed,
  inject,
  Injectable,
  PLATFORM_ID,
  resource,
  signal,
} from '@angular/core';
import { RunGroup, RunInfo } from '../../../../runner/shared-interfaces';
import { isPlatformBrowser } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class ReportsFetcher {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly pendingFetches = signal(0);
  private readonly runCache = new Map<string, RunInfo>();
  private readonly groupsResource = resource({
    loader: async () => {
      if (!isPlatformBrowser(this.platformId)) {
        return [];
      }

      const response = await fetch('/api/reports');

      if (!response.ok) {
        throw new Error(`Response status: ${response.status}`);
      }

      const groups = (await response.json()) as RunGroup[];

      return groups.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    },
  });

  readonly reportGroups = computed(() => {
    return this.groupsResource.hasValue() ? this.groupsResource.value() : [];
  });

  readonly reportGroupsError = computed(() => this.groupsResource.error());

  readonly isLoadingSingleReport = computed(() => this.pendingFetches() > 0);
  readonly isLoadingReportsList = computed(() =>
    this.groupsResource.isLoading()
  );

  async getCombinedReport(groupId: string): Promise<RunInfo> {
    if (!this.runCache.has(groupId)) {
      this.pendingFetches.update((current) => current + 1);

      try {
        const response = await fetch(`/api/reports/${groupId}`);

        if (!response.ok) {
          throw new Error(`Response status: ${response.status}`);
        }

        const allRuns = (await response.json()) as RunInfo[];

        if (!Array.isArray(allRuns) || allRuns.length === 0) {
          throw new Error(`Could not find report with id: ${groupId}`);
        }

        const firstRun = allRuns[0];
        const combined = {
          id: firstRun.id,
          group: firstRun.group,
          details: firstRun.details,
          results: allRuns.flatMap((run) => run.results),
        } satisfies RunInfo;

        this.runCache.set(groupId, combined);
      } finally {
        this.pendingFetches.update((current) => current - 1);
      }
    }

    return this.runCache.get(groupId)!;
  }
}
