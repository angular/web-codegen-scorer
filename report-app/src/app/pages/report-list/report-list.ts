import {Component, computed, inject, PLATFORM_ID, signal} from '@angular/core';
import {Router, RouterLink} from '@angular/router';
import {ReportsFetcher} from '../../services/reports-fetcher';
import {DatePipe, isPlatformServer} from '@angular/common';
import {ScoreBucket, RunGroup} from '../../../../../runner/shared-interfaces';
import {
  StackedBarChart,
  StackedBarChartData,
} from '../../shared/visualization/stacked-bar-chart/stacked-bar-chart';
import {MessageSpinner} from '../../shared/message-spinner';
import {Score} from '../../shared/score/score';
import {ProviderLabel} from '../../shared/provider-label';
import {bucketToScoreVariable} from '../../shared/scoring';

@Component({
  selector: 'app-report-list',
  imports: [RouterLink, DatePipe, StackedBarChart, MessageSpinner, Score, ProviderLabel],
  templateUrl: './report-list.html',
  styleUrls: ['./report-list.scss'],
})
export class ReportListComponent {
  private reportsFetcher = inject(ReportsFetcher);
  private router = inject(Router);
  private allGroups = this.reportsFetcher.reportGroups;

  protected isLoading = this.reportsFetcher.isLoadingReportsList;
  protected reportsToCompare = signal<string[]>([]);
  protected isServer = isPlatformServer(inject(PLATFORM_ID));

  protected selectedFramework = signal<string | null>(null);
  protected selectedModel = signal<string | null>(null);
  protected selectedRunner = signal<string | null>(null);

  protected allFrameworks = computed(() => {
    const frameworks = new Map<string, string>();
    this.allGroups().forEach(group => {
      const framework = group.framework.fullStackFramework;
      frameworks.set(framework.id, framework.displayName);
    });
    return Array.from(frameworks.entries()).map(([id, displayName]) => ({
      id,
      displayName,
    }));
  });

  protected allModels = computed(() => {
    const models = new Set(this.allGroups().map(g => g.model));

    return Array.from(models).map(model => ({
      id: model,
      displayName: model,
    }));
  });

  protected allRunners = computed(() => {
    const runners = new Map<string, string>();

    this.allGroups().forEach(group => {
      if (group.runner) {
        runners.set(group.runner.id, group.runner.displayName);
      }
    });

    return Array.from(runners.entries()).map(([id, displayName]) => ({
      id,
      displayName,
    }));
  });

  protected reportGroups = computed(() => {
    const framework = this.selectedFramework();
    const model = this.selectedModel();
    const runner = this.selectedRunner();
    const groups = this.allGroups();

    return groups.filter(group => {
      const frameworkMatch = !framework || group.framework.fullStackFramework.id === framework;
      const modelMatch = !model || group.model === model;
      const runnerMatch = !runner || group.runner?.id === runner;
      return frameworkMatch && modelMatch && runnerMatch;
    });
  });

  protected isCompareMode = signal(false);

  protected handleCompare() {
    if (this.reportsToCompare().length > 0) {
      this.navigateToComparison();
    } else {
      this.toggleCompareMode();
    }
  }

  protected toggleCompareMode(): void {
    this.isCompareMode.update(value => !value);
    if (!this.isCompareMode()) {
      this.reportsToCompare.set([]);
    }
  }

  protected onCheckboxChange(event: Event, id: string) {
    const checkbox = event.target as HTMLInputElement;
    if (checkbox.checked) {
      this.reportsToCompare.update(reports => [...reports, id]);
    } else {
      this.reportsToCompare.update(reports => reports.filter(r => r !== id));
    }
  }

  protected isReportSelectedForComparison(id: string): boolean {
    return this.reportsToCompare().includes(id);
  }

  protected removeReportFromComparison(id: string) {
    this.reportsToCompare.update(reports => reports.filter(r => r !== id));
  }

  protected navigateToComparison() {
    this.router.navigate(['/comparison'], {
      queryParams: {
        groups: this.reportsToCompare(),
      },
    });
  }

  protected getGraphData(group: RunGroup): StackedBarChartData {
    return group.stats.buckets.map((b: ScoreBucket) => ({
      label: b.nameWithLabels,
      color: bucketToScoreVariable(b),
      value: b.appsCount,
    }));
  }
}
