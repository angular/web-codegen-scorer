import {Component, computed, input, signal} from '@angular/core';

export type StackedBarChartData = Array<{
  label: string;
  color: string;
  value: number;
}>;

@Component({
  selector: 'stacked-bar-chart',
  styleUrl: 'stacked-bar-chart.scss',
  templateUrl: 'stacked-bar-chart.html',
})
export class StackedBarChart {
  data = input.required<StackedBarChartData>();
  compact = input(false);
  showLegend = input(true);

  total = computed(() => this.data().reduce((acc, item) => acc + item.value, 0));

  protected displayPercentage = signal(false);

  asPercent(value: number) {
    if (this.total() === 0) return 0;
    const percentage = (value / this.total()) * 100;
    return parseFloat(percentage.toFixed(percentage % 1 === 0 ? 0 : 1));
  }

  toggleDisplayMode(): void {
    this.displayPercentage.update(current => !current);
  }

  getItemDisplayValue(item: StackedBarChartData[0]): string {
    if (item.value === 0) return '';
    return this.displayPercentage() ? `${this.asPercent(item.value)}%` : `${item.value}`;
  }
}
