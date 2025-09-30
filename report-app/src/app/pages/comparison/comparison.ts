import {Component, computed, inject, linkedSignal} from '@angular/core';
import {toSignal} from '@angular/core/rxjs-interop';
import {map} from 'rxjs';
import {ComparisonScoreDistribution} from '../../shared/comparison/comparison-score-distribution';
import {ComparisonBuildDistribution} from '../../shared/comparison/comparison-build-distribution';
import {ModelComparisonData} from '../../shared/comparison/comparison-data';
import {ReportsFetcher} from '../../services/reports-fetcher';
import {ReportSelect} from '../../shared/report-select/report-select';
import {ComparisonRuntimeDistribution} from '../../shared/comparison/comparison-runtime-distribution';
import {ActivatedRoute} from '@angular/router';

@Component({
  templateUrl: './comparison.html',
  styleUrl: './comparison.scss',
  imports: [
    ComparisonScoreDistribution,
    ComparisonBuildDistribution,
    ComparisonRuntimeDistribution,
    ReportSelect,
  ],
})
export class ComparisonPage {
  private reportsFetcher = inject(ReportsFetcher);
  private route = inject(ActivatedRoute);

  readonly groups = this.reportsFetcher.reportGroups;
  readonly groupsToCompare = linkedSignal({
    source: () => ({
      groups: this.groups(),
      selectedIds: this.selectedGroups(),
    }),
    computation: () => {
      const allGroups = this.groups();
      const results: {reportName: string; groupId: string | null}[] = [];

      this.selectedGroups().forEach(id => {
        const correspondingGroup = allGroups.find(group => group.id === id);

        if (correspondingGroup) {
          results.push({
            groupId: correspondingGroup.id,
            reportName: correspondingGroup.displayName,
          });
        }
      });

      return results;
    },
  });

  readonly selectedGroups = toSignal<string[]>(
    this.route.queryParams.pipe(
      map(params => {
        const ids = params['groups'];
        return ids && Array.isArray(ids) ? ids : [];
      }),
    ),
    {requireSync: true},
  );

  readonly comparisonModelData = computed(() => {
    const allGroups = this.groups();
    const selectedGroups = this.groupsToCompare()
      .map(g => ({
        reportName: g.reportName,
        group: allGroups.find(current => current.id === g.groupId)!,
      }))
      .filter(g => !!g.group);

    if (selectedGroups.length < 2) {
      return null;
    }

    return {
      averageAppsCount: Math.floor(
        selectedGroups.reduce((acc, r) => r.group.appsCount + acc, 0) / selectedGroups.length,
      ),
      series: [
        ...selectedGroups.map(r => ({
          name: r.reportName,
          stats: r.group.stats,
          appsCount: r.group.appsCount,
        })),
      ],
    } satisfies ModelComparisonData;
  });

  protected updateReportName(report: {reportName: string}, newName: string) {
    report.reportName = newName;
    this.groupsToCompare.set([...this.groupsToCompare()]);
  }

  protected setSelectedGroup(index: number, groupId: string | undefined) {
    const allGroups = this.groups();
    const current = this.groupsToCompare();
    const correspondingGroup = allGroups.find(group => group.id === groupId);

    if (correspondingGroup) {
      current[index] = {
        groupId: correspondingGroup.id,
        reportName: correspondingGroup.displayName,
      };
      this.groupsToCompare.set([...current]);
    }
  }

  protected addCompareBox() {
    const currentReports = this.groupsToCompare();
    currentReports.push({
      groupId: null,
      reportName: `Report ${currentReports.length + 1}`,
    });
    this.groupsToCompare.set([...currentReports]);
  }

  protected removeCompareBox(index: number) {
    const currentReports = this.groupsToCompare();
    currentReports.splice(index, 1);
    this.groupsToCompare.set([...currentReports]);
  }
}
