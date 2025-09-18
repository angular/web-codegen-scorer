import { Component, inject, PLATFORM_ID } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ReportsFetcher } from './services/reports-fetcher';
import { isPlatformServer } from '@angular/common';
import { AppColorMode } from './services/app-color-mode';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrls: ['./app.scss'],
})
export class App {
  private reportsFetcher = inject(ReportsFetcher);
  private colorModeService = inject(AppColorMode);

  protected groups = this.reportsFetcher.reportGroups;
  protected isLoading = this.reportsFetcher.isLoadingReportsList;
  protected isServer = isPlatformServer(inject(PLATFORM_ID));
  protected colorMode = this.colorModeService.colorMode;
  protected groupsError = this.reportsFetcher.reportGroupsError;

  protected toggleColorMode() {
    this.colorModeService.setColorMode(
      this.colorMode() === 'light' ? 'dark' : 'light'
    );
  }
}
