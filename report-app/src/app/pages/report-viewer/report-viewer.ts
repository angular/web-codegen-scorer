import {Clipboard} from '@angular/cdk/clipboard';
import {DatePipe, DecimalPipe} from '@angular/common';
import {HttpClient} from '@angular/common/http';
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
import {NgxJsonViewerModule} from 'ngx-json-viewer';
import {
  BuildErrorType,
  BuildResultStatus,
} from '../../../../../runner/workers/builder/builder-types';
import {
  AssessmentResult,
  AssessmentResultFromReportServer,
  IndividualAssessment,
  IndividualAssessmentState,
  LlmResponseFile,
  RunInfo,
  RunInfoFromReportServer,
  RunSummaryBuilds,
  RunSummaryTests,
  RuntimeStats,
  ScoreBucket,
  SkippedIndividualAssessment,
} from '../../../../../runner/shared-interfaces';
import {CodeViewer} from '../../shared/code-viewer';
import {ReportsFetcher} from '../../services/reports-fetcher';
import {
  StackedBarChart,
  StackedBarChartData,
} from '../../shared/visualization/stacked-bar-chart/stacked-bar-chart';
import {formatFile} from './formatter';
import {MessageSpinner} from '../../shared/message-spinner';
import {createPromptDebuggingZip} from '../../shared/debugging-zip';
import {Score} from '../../shared/score/score';
import {bucketToScoreVariable, formatScore, ScoreCssVariable} from '../../shared/scoring';
import {ExpansionPanel} from '../../shared/expansion-panel/expansion-panel';
import {ExpansionPanelHeader} from '../../shared/expansion-panel/expansion-panel-header';
import {ProviderLabel} from '../../shared/provider-label';
import {AiAssistant} from '../../shared/ai-assistant/ai-assistant';
import {LighthouseCategory} from './lighthouse-category';
import {MultiSelect} from '../../shared/multi-select/multi-select';
import {FileCodeViewer} from '../../shared/file-code-viewer/file-code-viewer';

const localReportRegex = /-l\d+$/;

@Component({
  imports: [
    StackedBarChart,
    CodeViewer,
    DatePipe,
    DecimalPipe,
    MessageSpinner,
    Score,
    ExpansionPanel,
    ExpansionPanelHeader,
    ProviderLabel,
    NgxJsonViewerModule,
    AiAssistant,
    LighthouseCategory,
    MultiSelect,
    FileCodeViewer,
  ],
  templateUrl: './report-viewer.html',
  styleUrls: ['./report-viewer.scss'],
})
export class ReportViewer {
  private clipboard = inject(Clipboard);
  private reportsFetcher = inject(ReportsFetcher);
  private http = inject(HttpClient);

  constructor() {
    // Scroll the page to the top since it seems to always land slightly scrolled down.
    afterNextRender(() => window.scroll(0, 0));
  }

  // Set by the router component input bindings.
  protected reportGroupId = input.required<string>({alias: 'id'});
  protected formatted = signal<Map<LlmResponseFile, string>>(new Map());
  protected formatScore = formatScore;
  protected error = computed(() => this.selectedReport.error());
  protected isAiAssistantVisible = signal(false);
  protected openAppIDs = signal<string[]>([]);

  isAppOpen(result: AssessmentResultFromReportServer): boolean {
    return this.openAppIDs().includes(result.id);
  }

  setAppOpen(result: AssessmentResultFromReportServer, isOpen: boolean): void {
    if (isOpen) {
      this.openAppIDs.update(ids => [...ids, result.id]);
    } else {
      this.openAppIDs.update(ids => ids.filter(i => i !== result.id));
    }
  }

  private selectedReport = resource({
    params: () => ({groupId: this.reportGroupId()}),
    loader: ({params}) => this.reportsFetcher.getCombinedReport(params.groupId),
  });

  protected selectedReportWithSortedResults = computed<RunInfoFromReportServer | null>(() => {
    if (!this.selectedReport.hasValue()) {
      return null;
    }
    const report = this.selectedReport.value();
    return {
      id: report.id,
      group: report.group,
      details: report.details,
      results: [...report.results].sort((a, b) => a.promptDef.name.localeCompare(b.promptDef.name)),
    };
  });

  protected overview = computed(() => {
    const id = this.reportGroupId();
    return this.reportsFetcher.reportGroups().find(group => group.id === id);
  });

  protected selectedChecks = signal<string[]>([]);

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
          failedChecksMap.set(checkName, (failedChecksMap.get(checkName) || 0) + 1);
        }
      }
    }

    const failedChecksArray = Array.from(failedChecksMap.entries()).map(([name, count]) => ({
      label: `${name} (${count})`,
      value: name,
    }));

    return failedChecksArray.sort((a, b) => a.label.localeCompare(b.label));
  });

  protected filteredResults = computed(() => {
    const report = this.selectedReportWithSortedResults();
    const checks = this.selectedChecks();

    if (!report) {
      return [];
    }

    if (checks.length === 0) {
      return report.results;
    }

    return report.results.filter(result => {
      if (result.score.totalPoints === result.score.maxOverallPoints) {
        return false;
      }
      for (const category of result.score.categories) {
        for (const assessment of category.assessments) {
          if (this.isSkippedAssessment(assessment)) {
            continue;
          }
          if (assessment.successPercentage < 1 && checks.includes(assessment.name)) {
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

    const initialFailures: Record<string, {testCase: string; message: string}[]> = {};
    const repairFailures: Record<string, {testCase: string; message: string}[]> = {};

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

    const hasInitialFailures = Object.values(initialFailures).some(arr => arr.length > 0);
    const hasRepairFailures = Object.values(repairFailures).some(arr => arr.length > 0);

    return {
      initialFailures: Object.entries(initialFailures),
      repairFailures: Object.entries(repairFailures),
      hasInitialFailures,
      hasRepairFailures,
    };
  });

  protected getScreenshotUrl(result: AssessmentResult): string | null {
    return result.finalAttempt.serveTestingResult?.screenshotPngUrl ?? null;
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

  protected hasSuccessfulResultWithMoreThanOneBuildAttempt = computed(() => {
    if (!this.selectedReport.hasValue()) {
      return false;
    }
    for (const result of this.selectedReport.value().results) {
      if (
        result.finalAttempt.buildResult.status === BuildResultStatus.SUCCESS &&
        result.repairAttempts > 1
      ) {
        return true;
      }
    }
    return false;
  });

  protected averageRepairAttempts = computed<number | null>(() => {
    const report = this.selectedReportWithSortedResults();
    if (!report) {
      return null;
    }

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
  });

  protected repairAttemptsAsGraphData = computed<StackedBarChartData>(() => {
    const report = this.selectedReportWithSortedResults();
    if (!report) {
      return [];
    }

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

    const minGrade = 1;
    const maxGrade = 8;
    const failureGrade = 9;

    for (let repairCount = 1; repairCount <= maxRepairCount; repairCount++) {
      const applicationCount = repairsToAppCount.get(repairCount);
      if (!applicationCount) continue;
      const label = `${repairCount} repair${repairCount > 1 ? 's' : ''}`;

      // Normalize the repair count to the range [0, 1].
      const normalizedRepairCount = (repairCount - 1) / (maxRepairCount - 1);

      let gradeIndex: number;
      if (intermediateRepairKeys.length === 1) {
        // If there's only one intermediate repair count, map it to a middle grade (e.g., --chart-grade-5)
        gradeIndex = Math.floor(maxGrade / 2) + minGrade;
      } else {
        // Distribute multiple intermediate repair counts evenly across available grades
        gradeIndex = minGrade + Math.round(normalizedRepairCount * (maxGrade - minGrade));
      }

      data.push({
        label,
        color: `var(--chart-grade-${gradeIndex})`,
        value: applicationCount,
      });
    }

    // Handle 'Build failed even after all retries' - always maps to the "failure" grade.
    const failedCount = repairsToAppCount.get('failed') || 0;
    if (failedCount > 0) {
      data.push({
        label: 'Build failed even after all retries',
        color: `var(--chart-grade-${failureGrade})`,
        value: failedCount,
      });
    }
    return data;
  });

  protected testsAsGraphData(tests: RunSummaryTests): StackedBarChartData {
    return [
      {
        label: 'Passed',
        color: ScoreCssVariable.excellent,
        value: tests.successfulInitialTests,
      },
      {
        label: 'Passed after repair',
        color: ScoreCssVariable.great,
        value: tests.successfulTestsAfterRepair,
      },
      {
        label: 'Failed',
        color: ScoreCssVariable.poor,
        value: tests.failedTests,
      },
      {
        label: 'No tests run',
        color: ScoreCssVariable.neutral,
        value: tests.noTestsRun,
      },
    ];
  }

  protected checksAsGraphData(buckets: ScoreBucket[]): StackedBarChartData {
    return buckets.map(b => ({
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

  protected securityStatsAsGraphData(stats: {appsWithErrors: number; appsWithoutErrors: number}) {
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
    value: IndividualAssessment | SkippedIndividualAssessment,
  ): value is SkippedIndividualAssessment {
    return value.state === IndividualAssessmentState.SKIPPED;
  }

  protected async format(file: LlmResponseFile): Promise<void> {
    const result = await formatFile(file, this.selectedReport.value()!.details.summary.framework);
    if (typeof result === 'string') {
      this.formatted.update(oldMap => {
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
    const blob = await createPromptDebuggingZip(this.selectedReport.value()!, app);

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

  protected getDebugCommand(report: RunInfo, result: AssessmentResult): string | null {
    // Only show the command for local reports.
    if (!localReportRegex.test(report.group)) {
      return null;
    }

    return `wcs run --prompt=${result.promptDef.name} --env=<path to ${report.details.summary.environmentId} config>`;
  }

  protected hasBuildFailureDuringTestRepair(result: AssessmentResult): boolean {
    return result.attemptDetails.some(attempt => attempt.buildFailedDuringTestRepair);
  }
}
