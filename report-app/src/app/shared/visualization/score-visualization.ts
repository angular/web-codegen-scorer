import {afterRenderEffect, Component, ElementRef, inject, input, viewChild} from '@angular/core';
import {RunGroup} from '../../../../../runner/shared-interfaces';
import {GoogleChartsLoader} from '../../services/google-charts-loader';
import {AppResizeNotifier} from '../../services/app-resize-notifier';
import {AppColorMode} from '../../services/app-color-mode';

@Component({
  selector: 'score-visualization',
  template: `<div #chart></div>`,
})
export class ScoreVisualization {
  private googleChartsLoader = inject(GoogleChartsLoader);
  private notifier = inject(AppResizeNotifier);
  private colorModeService = inject(AppColorMode);

  readonly groups = input.required<RunGroup[]>();
  readonly chartContainer = viewChild.required<ElementRef>('chart');

  constructor() {
    afterRenderEffect(() => this._renderChart());
    this.notifier.register(() => this._renderChart());
  }

  private _processData() {
    const dataRows: Record<
      string,
      {
        buildQualityPercentages: number[];
        overallQualityPercentages: number[];
        timestamp: Date;
      }
    > = {};
    let appsCount = 0;

    for (const group of this.groups()) {
      const buildStats = group.stats.builds;
      const overallQuality = group.totalPoints / group.maxOverallPoints || 0;
      const dayDate = new Date(group.timestamp);
      dayDate.setHours(0, 0, 0, 0);
      const dayKey = dayDate.toUTCString();

      dataRows[dayKey] ??= {
        buildQualityPercentages: [],
        overallQualityPercentages: [],
        timestamp: dayDate,
      };
      dataRows[dayKey].buildQualityPercentages.push(
        (buildStats.successfulBuildsAfterRepair + buildStats.successfulInitialBuilds) /
          group.appsCount,
      );
      dataRows[dayKey].overallQualityPercentages.push(overallQuality);
      appsCount += group.appsCount;
    }

    return {dataRows, averageAppsCount: appsCount / this.groups().length};
  }

  private async _renderChart() {
    // Note: we need to call `_processData` synchronously
    // so the wrapping effect picks up the data dependency.
    const {dataRows, averageAppsCount} = this._processData();
    const colorMode = this.colorModeService.colorMode();

    await this.googleChartsLoader.ready;

    const table = new google.visualization.DataTable();

    table.addColumn('date', 'Date');
    //  table.addColumn('number', 'Build Quality');
    table.addColumn('number', 'Overall Quality');

    table.addRows(
      Object.values(dataRows).map(r => [
        r.timestamp,
        // TODO: Consider incorporating build quality scores.
        //   r.buildQualityPercentages.reduce((a, b) => a + b) /
        //     r.buildQualityPercentages.length,
        r.overallQualityPercentages.reduce((a, b) => a + b) / r.overallQualityPercentages.length,
      ]),
    );

    const chart = new google.visualization.LineChart(this.chartContainer().nativeElement);
    const textColor = colorMode === 'dark' ? '#f9fafb' : '#1e293b';

    chart.draw(table, {
      curveType: 'function',
      title: `Score average over time (~${averageAppsCount.toFixed(0)} apps generated per day)`,
      titleTextStyle: {color: textColor},
      backgroundColor: 'transparent',
      vAxis: {
        format: 'percent',
        viewWindowMode: 'maximized',
        textStyle: {color: textColor},
        maxValue: 1,
      },
      legend: {textStyle: {color: textColor}},
      hAxis: {
        minTextSpacing: 20,
        textStyle: {fontSize: 10, color: textColor},
      },
      chartArea: {
        left: 50,
        right: 155,
        bottom: 10,
        top: 50,
      },
      // TODO: Consider enabling trendlines.
      // trendlines: { 0: {}, 1: {} },
    });
  }
}
