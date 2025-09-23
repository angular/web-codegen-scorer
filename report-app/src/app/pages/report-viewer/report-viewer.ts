import { Clipboard } from '@angular/cdk/clipboard';
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { NgxJsonViewerModule } from 'ngx-json-viewer';
import { BuildErrorType } from '../../../../../runner/builder/builder-types';
import {
  AssessmentResult,
  IndividualAssessment,
  IndividualAssessmentState,
  LlmResponseFile,
  RunInfo,
  RunSummaryBuilds,
  RuntimeStats,
  ScoreBucket,
  SkippedIndividualAssessment,
} from '../../../../../runner/shared-interfaces';
import { CodeViewer } from '../../shared/code-viewer';
import { ReportsFetcher } from '../../services/reports-fetcher';
import {
  StackedBarChart,
  StackedBarChartData,
} from '../../shared/visualization/stacked-bar-chart/stacked-bar-chart';
import { formatFile } from './formatter';
import { FailedChecksFilter } from './failed-checks-filter';
import { MessageSpinner } from '../../shared/message-spinner';
import { createPromptDebuggingZip } from '../../shared/debugging-zip';
import { Score } from '../../shared/score/score';
import {
  bucketToScoreVariable,
  formatScore,
  ScoreCssVariable,
} from '../../shared/scoring';
import { ExpansionPanel } from '../../shared/expansion-panel/expansion-panel';
import { ExpansionPanelHeader } from '../../shared/expansion-panel/expansion-panel-header';
import { ProviderLabel } from '../../shared/provider-label';

@Component({
  imports: [
    StackedBarChart,
    CodeViewer,
    DatePipe,
    DecimalPipe,
    FailedChecksFilter,
    MessageSpinner,
    Score,
    ExpansionPanel,
    ExpansionPanelHeader,
    ProviderLabel,
    NgxJsonViewerModule,
  ],
  templateUrl: './report-viewer.html',
  styleUrls: ['./report-viewer.scss'],
  host: {
    '(document:click)': 'closeDropdownIfOpen($event)',
  },
})
export class ReportViewer {
  private clipboard = inject(Clipboard);
  private reportsFetcher = inject(ReportsFetcher);

  constructor() {
    // Scroll the page to the top since it seems to always land slightly scrolled down.
    afterNextRender(() => window.scroll(0, 0));
  }

  // Set by the router component input bindings.
  protected reportGroupId = input.required<string>({ alias: 'id' });
  protected formatted = signal<Map<LlmResponseFile, string>>(new Map());
  protected formatScore = formatScore;
  protected error = computed(() => this.selectedReport.error());

  private selectedReport = resource({
    params: () => ({ groupId: this.reportGroupId() }),
    loader: ({ params }) =>
      this.reportsFetcher.getCombinedReport(params.groupId),
  });

  protected selectedReportWithSortedResults = computed<RunInfo | null>(() => {
    if (!this.selectedReport.hasValue()) {
      return null;
    }
    const report = this.selectedReport.value();
    return {
      id: report.id,
      group: report.group,
      details: report.details,
      results: [...report.results].sort((a, b) =>
        a.promptDef.name.localeCompare(b.promptDef.name)
      ),
    };
  });

  protected overview = computed(() => {
    const id = this.reportGroupId();
    return this.reportsFetcher.reportGroups().find((group) => group.id === id);
  });

  protected selectedChecks = signal<Set<string>>(new Set());

  protected allFailedChecks = computed(() => {
    if (!this.selectedReport.hasValue()) {
      return [];
    }

    const report = this.selectedReport.value();
    const failedChecksMap = new Map<string, number>();
    for (const result of report.results) {
      if (result.score.totalPoints < result.score.maxOverallPoints) {
        const failedChecksInApp = new Set<string>();
        for (const category of result.score.categories) {
          for (const assessment of category.assessments) {
            if (this.isSkippedAssessment(assessment)) {
              continue;
            }
            if (assessment.successPercentage < 1) {
              failedChecksInApp.add(assessment.name);
            }
          }
        }
        for (const checkName of failedChecksInApp) {
          failedChecksMap.set(
            checkName,
            (failedChecksMap.get(checkName) || 0) + 1
          );
        }
      }
    }

    const failedChecksArray = Array.from(failedChecksMap.entries()).map(
      ([name, count]) => ({
        name,
        count,
      })
    );

    return failedChecksArray.sort((a, b) => a.name.localeCompare(b.name));
  });

  protected filteredResults = computed(() => {
    const report = this.selectedReportWithSortedResults();
    const checks = this.selectedChecks();

    if (!report) {
      return [];
    }

    if (checks.size === 0) {
      return report.results;
    }

    return report.results.filter((result) => {
      if (result.score.totalPoints === result.score.maxOverallPoints) {
        return false;
      }
      for (const category of result.score.categories) {
        for (const assessment of category.assessments) {
          if (this.isSkippedAssessment(assessment)) {
            continue;
          }
          if (assessment.successPercentage < 1 && checks.has(assessment.name)) {
            return true;
          }
        }
      }
      return false;
    });
  });

  protected buildErrors = computed(() => {
    const report = this.selectedReportWithSortedResults();
    if (!report) {
      return null;
    }

    const initialFailures: Record<
      string,
      { testCase: string; message: string }[]
    > = {};
    const repairFailures: Record<
      string,
      { testCase: string; message: string }[]
    > = {};

    for (const result of report.results) {
      const initialAttempt = result.attemptDetails[0];
      if (initialAttempt?.buildResult.status === 'error') {
        const br = initialAttempt.buildResult;
        const errorType = br.errorType ?? BuildErrorType.OTHER;
        if (!initialFailures[errorType]) {
          initialFailures[errorType] = [];
        }
        const message = br.missingDependency ?? br.message;
        initialFailures[errorType].push({
          testCase: result.promptDef.name,
          message: message,
        });
      }

      const repairAttempt = result.attemptDetails[1];
      if (repairAttempt?.buildResult.status === 'error') {
        const br = repairAttempt.buildResult;
        const errorType = br.errorType ?? BuildErrorType.OTHER;
        if (!repairFailures[errorType]) {
          repairFailures[errorType] = [];
        }
        const message = br.missingDependency ?? br.message;
        repairFailures[errorType].push({
          testCase: result.promptDef.name,
          message: message,
        });
      }
    }

    const hasInitialFailures = Object.values(initialFailures).some(
      (arr) => arr.length > 0
    );
    const hasRepairFailures = Object.values(repairFailures).some(
      (arr) => arr.length > 0
    );

    return {
      initialFailures: Object.entries(initialFailures),
      repairFailures: Object.entries(repairFailures),
      hasInitialFailures,
      hasRepairFailures,
    };
  });

  protected getScreenshotUrl(result: AssessmentResult): string | null {
    return result.build.screenshotPngUrl ?? null;
  }

  protected isLoading = this.reportsFetcher.isLoadingSingleReport;

  protected missingDeps = computed(() => {
    const report = this.selectedReport.value();
    if (!report) return [];

    const deps = new Map<string, Set<string>>();
    for (const result of report.results) {
      for (const attempt of result.attemptDetails) {
        const dep = attempt.buildResult.missingDependency;
        if (dep) {
          if (!deps.has(dep)) {
            deps.set(dep, new Set());
          }
          deps.get(dep)!.add(result.promptDef.name);
        }
      }
    }
    return Array.from(deps).sort();
  });

  protected buildsAsGraphData(builds: RunSummaryBuilds): StackedBarChartData {
    return [
      {
        label: 'Successful',
        color: ScoreCssVariable.excellent,
        value: builds.successfulInitialBuilds,
      },
      {
        label: 'Successful after repair',
        color: ScoreCssVariable.great,
        value: builds.successfulBuildsAfterRepair,
      },
      {
        label: 'Failed',
        color: ScoreCssVariable.poor,
        value: builds.failedBuilds,
      },
    ];
  }

  protected checksAsGraphData(buckets: ScoreBucket[]): StackedBarChartData {
    return buckets.map((b) => ({
      label: b.nameWithLabels,
      color: bucketToScoreVariable(b),
      value: b.appsCount,
    }));
  }

  protected runtimeStatsAsGraphData(runtimeStats: RuntimeStats) {
    return [
      {
        label: 'No exceptions',
        color: ScoreCssVariable.excellent,
        value: runtimeStats.appsWithoutErrors,
      },
      {
        label: 'Have exceptions',
        color: ScoreCssVariable.poor,
        value: runtimeStats.appsWithErrors,
      },
    ];
  }

  protected securityStatsAsGraphData(stats: {
    appsWithErrors: number;
    appsWithoutErrors: number;
  }) {
    return [
      {
        label: 'No exceptions',
        color: ScoreCssVariable.excellent,
        value: stats.appsWithoutErrors,
      },
      {
        label: 'Have exceptions',
        color: ScoreCssVariable.poor,
        value: stats.appsWithErrors,
      },
    ];
  }

  protected accessibilityStatsAsGraphData(stats: {
    appsWithErrors: number;
    appsWithoutErrorsAfterRepair?: number;
    appsWithoutErrors: number;
  }) {
    return [
      {
        label: 'No violations',
        color: ScoreCssVariable.excellent,
        value: stats.appsWithoutErrors,
      },
      // Conditionally add the 'Successful after repair' bar. This property is
      // optional to maintain backwards compatibility with older reports where
      // this metric was not calculated.
      ...(typeof stats.appsWithoutErrorsAfterRepair === 'number'
        ? [
            {
              label: 'Successful after repair',
              color: ScoreCssVariable.great,
              value: stats.appsWithoutErrorsAfterRepair,
            },
          ]
        : []),
      {
        label: 'Have violations',
        color: ScoreCssVariable.poor,
        value: stats.appsWithErrors,
      },
    ];
  }

  protected renderSetToString(s: Set<unknown>): string {
    return Array.from(s).join(', ');
  }

  protected copy(value: string): void {
    if (!this.clipboard.copy(value)) {
      alert('Failed to copy text');
    }
  }

  protected isSkippedAssessment(
    value: IndividualAssessment | SkippedIndividualAssessment
  ): value is SkippedIndividualAssessment {
    return value.state === IndividualAssessmentState.SKIPPED;
  }

  protected dropdownRef = viewChild<ElementRef>('dropdown');

  protected closeDropdownIfOpen(event: MouseEvent): void {
    const detailsElement = this.dropdownRef()?.nativeElement;
    if (
      detailsElement?.hasAttribute('open') &&
      !detailsElement.contains(event.target)
    ) {
      detailsElement.removeAttribute('open');
    }
  }

  protected toggleCheckFilter(check: string): void {
    this.selectedChecks.update((currentChecks) => {
      const checks = new Set(currentChecks);
      if (checks.has(check)) {
        checks.delete(check);
      } else {
        checks.add(check);
      }
      return checks;
    });
  }

  protected async format(file: LlmResponseFile): Promise<void> {
    const result = await formatFile(
      file,
      this.selectedReport.value()!.details.summary.framework
    );
    if (typeof result === 'string') {
      this.formatted.update((oldMap) => {
        const newMap = new Map(oldMap);
        newMap.set(file, result);
        return newMap;
      });
    } else {
      // TODO: Should the error be shown in the UI?
      console.error(result.error);
    }
  }

  /**
   * Creates and triggers a download for a ZIP file containing debugging information for a
   * specific app. The ZIP file includes the prompt, generated files, and any build/runtime errors.
   * This is useful for further analysis of a specific app in AI Studio.
   * @param app The assessment result for which to create the debugging zip.
   */
  protected async downloadDebuggingZip(app: AssessmentResult): Promise<void> {
    const blob = await createPromptDebuggingZip(
      this.selectedReport.value()!,
      app
    );

    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = `${app.promptDef.name}.zip`;
    link.click();
  }

  protected getClassNameForScore(percentage: number): string {
    if (percentage === 100) {
      return 'success';
    } else if (percentage >= 90) {
      return 'above-average';
    } else if (percentage >= 80) {
      return 'average';
    } else {
      return 'failed';
    }
  }
}
