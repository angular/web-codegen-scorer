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
import {ReportFilters} from '../../shared/report-filters/report-filters';

@Component({
  selector: 'app-report-list',
  imports: [
    RouterLink,
    DatePipe,
    StackedBarChart,
    MessageSpinner,
    Score,
    ProviderLabel,
    ReportFilters,
  ],
  templateUrl: './report-list.html',
  styleUrls: ['./report-list.scss'],
})
export class ReportListComponent {
  private reportsFetcher = inject(ReportsFetcher);
  private router = inject(Router);

  protected isLoading = this.reportsFetcher.isLoadingReportsList;
  protected reportsToCompare = signal<string[]>([]);
  protected isServer = isPlatformServer(inject(PLATFORM_ID));
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
