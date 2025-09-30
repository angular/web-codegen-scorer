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
  selector: 'comparison-runtime-distribution',
  templateUrl: './comparison-runtime-distribution.html',
  styleUrl: './comparison-runtime-distribution.scss',
  imports: [ComparisonStackedBarChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonRuntimeDistribution {
  private platformId = inject(PLATFORM_ID);
  private appColor = inject(AppColorMode);

  readonly data = input.required<ModelComparisonData>();

  readonly barChartData = computed<ComparisonStackedBarChartData>(() => {
    const colorMode = this.appColor.colorMode();
    const data = this.data();
    const result: ComparisonStackedBarChartData = {
      title: `Runtime error distribution (${data.averageAppsCount} apps)`,
      seriesColumns: [
        {
          name: 'No runtime errors',
          color: getHardcodedColor(this.platformId, ScoreCssVariable.excellent, colorMode),
        },
        {
          name: 'With runtime errors',
          color: getHardcodedColor(this.platformId, ScoreCssVariable.poor, colorMode),
        },
        {
          name: 'Did not run',
          color: getHardcodedColor(this.platformId, ScoreCssVariable.neutral, colorMode),
        },
      ],
      series: [],
    };

    const addSeriesData = (type: string, stats: AggregatedRunStats, total: number) => {
      // TODO: We should make `runtime` error collection required at this point.
      if (!stats.runtime) {
        console.error('No runtime stats for report in comparison. Skipping');
        return;
      }

      const {appsWithoutErrors, appsWithErrors} = stats.runtime;
      const withoutErrors = parseFloat((appsWithoutErrors / total).toFixed(3));
      const withErrors = parseFloat((appsWithErrors / total).toFixed(3));
      const remainder = parseFloat(
        ((total - (appsWithErrors + appsWithoutErrors)) / total).toFixed(3),
      );

      result.series.push({
        name: type,
        values: [
          {
            value: withoutErrors,
            label: withoutErrors > 0.05 ? `${(withoutErrors * 100).toFixed(1)}%` : '',
          },
          {
            value: withErrors,
            label: withErrors > 0.05 ? `${(withErrors * 100).toFixed(1)}%` : '',
          },
          {
            value: remainder,
            label: remainder > 0.05 ? `${(remainder * 100).toFixed(1)}%` : '',
          },
        ],
      });
    };

    for (const s of data.series) {
      addSeriesData(s.name, s.stats, s.appsCount);
    }

    return result;
  });
}
