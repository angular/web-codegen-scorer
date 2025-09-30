import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  PLATFORM_ID,
} from '@angular/core';
import {isPositiveScore} from '../../../../../runner/ratings/stats';
import {AggregatedRunStats} from '../../../../../runner/shared-interfaces';
import {
  ComparisonStackedBarChart,
  ComparisonStackedBarChartData,
} from '../visualization/comparison-stacked-bar-chart';
import {ModelComparisonData} from './comparison-data';
import {bucketToScoreVariable, getHardcodedColor} from '../scoring';
import {AppColorMode} from '../../services/app-color-mode';

@Component({
  selector: 'comparison-score-distribution',
  templateUrl: './comparison-score-distribution.html',
  styleUrl: './comparison-score-distribution.scss',
  imports: [ComparisonStackedBarChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonScoreDistribution {
  private platformId = inject(PLATFORM_ID);
  private colorService = inject(AppColorMode);

  readonly data = input.required<ModelComparisonData>();

  readonly barChartData = computed<ComparisonStackedBarChartData>(() => {
    const colorMode = this.colorService.colorMode();
    const data = this.data();
    const result: ComparisonStackedBarChartData = {
      title: `Code Quality distribution (${data.averageAppsCount} apps)`,
      seriesColumns: [],
      series: [],
    };

    const addSeriesData = (type: string, distribution: AggregatedRunStats, appsCount: number) => {
      // The buckets are the same for all results so populate
      // the columns when the first result is added.
      if (result.seriesColumns.length === 0) {
        for (const bucket of distribution.buckets) {
          result.seriesColumns.push({
            name: `${bucket.name} score`,
            color: getHardcodedColor(this.platformId, bucketToScoreVariable(bucket), colorMode),
          });
        }
      }

      result.series.push({
        name: type,
        values: distribution.buckets.map(bucket => {
          const percentage = parseFloat((bucket.appsCount / appsCount).toFixed(3));
          return {
            value: percentage,
            label: percentage > 0.05 ? `${(percentage * 100).toFixed(1)}%` : '',
          };
        }),
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
      const goodOrBetterCount = s.stats.buckets.reduce(
        (sum, bucket) => sum + (isPositiveScore(bucket) ? bucket.appsCount : 0),
        0,
      );

      return {
        name: s.name,
        goodOrBetter: ((goodOrBetterCount / s.appsCount) * 100).toFixed(1),
      };
    });
  });
}
