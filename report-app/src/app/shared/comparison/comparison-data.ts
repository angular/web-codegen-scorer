import {AggregatedRunStats} from '../../../../../runner/shared-interfaces';

export interface ModelComparisonData {
  series: Array<{
    name: string;
    stats: AggregatedRunStats;
    appsCount: number;
  }>;
  averageAppsCount: number;
}
