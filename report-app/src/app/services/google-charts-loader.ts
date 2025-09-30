/// <reference types="google.visualization" />

import {isPlatformBrowser} from '@angular/common';
import {inject, Injectable, PLATFORM_ID} from '@angular/core';

@Injectable({providedIn: 'root'})
export class GoogleChartsLoader {
  private _resolveReadyPromise: (() => void) | null = null;
  private platformId = inject(PLATFORM_ID);

  /** Whether the Google Charts API is ready for use. */
  ready: Promise<void>;

  constructor() {
    this.ready = new Promise(resolve => {
      this._resolveReadyPromise = resolve;
    });
  }

  /** Initializes the Google Charts API. */
  initialize() {
    if (isPlatformBrowser(this.platformId)) {
      // Load the Visualization API and the corechart package.
      google.charts.load('current', {packages: ['corechart']});

      // Set a callback to run when the Google Visualization API is loaded.
      google.charts.setOnLoadCallback(() => {
        this._resolveReadyPromise!();
      });
    }
  }
}
