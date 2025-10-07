import {ChangeDetectionStrategy, Component} from '@angular/core';
import {ScoreVisualization} from '../../shared/visualization/score-visualization';
import {ReportFilters} from '../../shared/report-filters/report-filters';

@Component({
  selector: 'trajectory',
  templateUrl: './trajectory.html',
  styleUrls: ['./trajectory.scss'],
  imports: [ScoreVisualization, ReportFilters],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Trajectory {}
