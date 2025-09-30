import {Routes} from '@angular/router';
import {ReportViewer} from './pages/report-viewer/report-viewer';
import {ComparisonPage} from './pages/comparison/comparison';
import {ReportListComponent} from './pages/report-list/report-list';

export const routes: Routes = [
  {
    path: 'reports',
    component: ReportListComponent,
  },
  {
    path: 'report/:id',
    component: ReportViewer,
  },
  {
    path: 'comparison',
    component: ComparisonPage,
  },
  {
    path: '',
    redirectTo: 'reports',
    pathMatch: 'full',
  },
];
