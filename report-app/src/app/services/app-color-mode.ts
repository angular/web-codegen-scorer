import {isPlatformBrowser} from '@angular/common';
import {inject, Injectable, PLATFORM_ID, signal} from '@angular/core';

const colorModeStorageKey = 'wcs-color-mode';

export type ColorMode = 'light' | 'dark';

@Injectable({providedIn: 'root'})
export class AppColorMode {
  private currentColorMode = signal<ColorMode>('light');
  readonly colorMode = this.currentColorMode.asReadonly();

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      let colorMode: ColorMode | null = null;

      try {
        // In some cases accessing localStorage can throw.
        colorMode = localStorage.getItem(colorModeStorageKey) as ColorMode | null;
      } catch {}

      if (!colorMode) {
        colorMode = matchMedia('(prefers-color-scheme: dark)') ? 'dark' : 'light';
      }

      this.setColorMode(colorMode);
    }
  }

  setColorMode(mode: ColorMode) {
    document.documentElement.classList.toggle('dark-mode', mode === 'dark');
    this.currentColorMode.set(mode);

    try {
      localStorage.setItem(colorModeStorageKey, mode);
    } catch {}
  }
}
