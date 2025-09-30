import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  PLATFORM_ID,
} from '@angular/core';
import {AggregatedRunStats} from '../../../../../runner/shared-interfaces';
import {
  ComparisonStackedBarChart,
  ComparisonStackedBarChartData,
} from '../visualization/comparison-stacked-bar-chart';
import {ModelComparisonData} from './comparison-data';
import {getHardcodedColor, ScoreCssVariable} from '../scoring';
import {AppColorMode} from '../../services/app-color-mode';

@Component({
  selector: 'comparison-build-distribution',
  templateUrl: './comparison-build-distribution.html',
  styleUrl: './comparison-build-distribution.scss',
  imports: [ComparisonStackedBarChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonBuildDistribution {
  private platformId = inject(PLATFORM_ID);
  private appColor = inject(AppColorMode);

  readonly data = input.required<ModelComparisonData>();

  readonly barChartData = computed<ComparisonStackedBarChartData>(() => {
    const colorMode = this.appColor.colorMode();
    const data = this.data();
    const result: ComparisonStackedBarChartData = {
      title: `Build Success distribution (${data.averageAppsCount} apps)`,
      seriesColumns: [
        {
          name: 'Successful initial builds',
          color: getHardcodedColor(this.platformId, ScoreCssVariable.excellent, colorMode),
        },
        {
          name: 'Successful builds after repair',
          color: getHardcodedColor(this.platformId, ScoreCssVariable.great, colorMode),
        },
        {
          name: 'Failed builds',
          color: getHardcodedColor(this.platformId, ScoreCssVariable.poor, colorMode),
        },
      ],
      series: [],
    };

    const addSeriesData = (type: string, stats: AggregatedRunStats, appsCount: number) => {
      const successfulInitialBuilds = parseFloat(
        (stats.builds.successfulInitialBuilds / appsCount).toFixed(3),
      );
      const successfulRepairedBuilds = parseFloat(
        (stats.builds.successfulBuildsAfterRepair / appsCount).toFixed(3),
      );
      const failedBuilds = parseFloat((stats.builds.failedBuilds / appsCount).toFixed(3));

      result.series.push({
        name: type,
        values: [
          {
            value: successfulInitialBuilds,
            label:
              successfulInitialBuilds > 0.05
                ? `${(successfulInitialBuilds * 100).toFixed(1)}%`
                : '',
          },
          {
            value: successfulRepairedBuilds,
            label:
              successfulRepairedBuilds > 0.05
                ? `${(successfulRepairedBuilds * 100).toFixed(1)}%`
                : '',
          },
          {
            value: failedBuilds,
            label: failedBuilds > 0.05 ? `${(failedBuilds * 100).toFixed(1)}%` : '',
          },
        ],
      });
    };

    for (const s of data.series) {
      addSeriesData(s.name, s.stats, s.appsCount);
    }

    return result;
  });

  readonly percentagesForTextOverview = computed(() => {
    const data = this.data();

    return data.series.map(s => {
      return {
        name: s.name,
        successfulBuilds: (
          ((s.stats.builds.successfulInitialBuilds + s.stats.builds.successfulBuildsAfterRepair) /
            s.appsCount) *
          100
        ).toFixed(1),
      };
    });
  });
}
