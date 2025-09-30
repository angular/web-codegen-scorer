import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  viewChild,
} from '@angular/core';
import {GoogleChartsLoader} from '../../services/google-charts-loader';
import {AppResizeNotifier} from '../../services/app-resize-notifier';
import {AppColorMode} from '../../services/app-color-mode';

export interface ComparisonStackedBarChartData {
  title: string;
  seriesColumns: Array<{name: string; color: string}>;
  series: Array<{
    name: string;
    values: Array<{
      label: string;
      value: number;
    }>;
  }>;
}

@Component({
  selector: 'comparison-stacked-bar-chart',
  template: `<div #chart></div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonStackedBarChart {
  private googleChartsLoader = inject(GoogleChartsLoader);
  private resizeNotifier = inject(AppResizeNotifier);
  private colorModeService = inject(AppColorMode);

  readonly data = input.required<ComparisonStackedBarChartData>();
  readonly chartEl = viewChild.required<ElementRef>('chart');

  constructor() {
    afterRenderEffect(() => this._renderChart());
    this.resizeNotifier.register(() => this._renderChart());
  }

  private async _renderChart() {
    const data = this.data();
    const colorMode = this.colorModeService.colorMode();
    await this.googleChartsLoader.ready;

    const table = new google.visualization.DataTable();

    table.addColumn('string', 'Name');

    for (const column of data.seriesColumns) {
      table.addColumn('number', column.name);
      table.addColumn({role: 'annotation'});
    }

    for (const s of data.series) {
      const row: (string | number)[] = [s.name];

      for (const value of s.values) {
        row.push(value.value);
        row.push(value.label);
      }

      table.addRow(row);
    }

    // The chart library seems to ignore CSS variable colors so we need to hardcode them.
    const textColor = colorMode === 'dark' ? '#f9fafb' : '#1e293b';
    const chart = new google.visualization.BarChart(this.chartEl().nativeElement);

    chart.draw(table, {
      title: data.title,
      titleTextStyle: {color: textColor},
      backgroundColor: 'transparent',
      hAxis: {
        minTextSpacing: 20,
        textStyle: {fontSize: 10, color: textColor},
        format: 'percent',
      },
      legend: {textStyle: {color: textColor}},
      isStacked: 'percent',
      series: data.seriesColumns.reduce(
        (res, s, index) => ({...res, [index]: {color: s.color}}),
        {},
      ),
      chartArea: {
        left: 250,
        right: 300,
        top: 50, // needs some space for the title and the tooltips
        bottom: 10,
      },
      height: data.series.length * 75,
      annotations: {
        alwaysOutside: false,
        style: 'point',
        textStyle: {
          italic: true,
          bold: false,
          fontSize: 12,
          color: textColor,
        },
      },
      vAxis: {
        minTextSpacing: 20,
        viewWindowMode: 'maximized',
        showTextEvery: 1,
        textStyle: {color: textColor},
      },
      // TODO: Consider enabling trendlines.
      // trendlines: { 0: {}, 1: {} },
    });
  }
}
