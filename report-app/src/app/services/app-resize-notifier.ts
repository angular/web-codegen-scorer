import {isPlatformBrowser} from '@angular/common';
import {ApplicationRef, DestroyRef, inject, Injectable, PLATFORM_ID} from '@angular/core';

/**
 * This service will be init at the first injection.
 *
 * It can be used after the root component is created.
 */
@Injectable({providedIn: 'root'})
export class AppResizeNotifier {
  constructor() {
    if (this.isBrowser) {
      this.initialize();
    }
  }

  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private _listeners: Array<() => void> = [];

  notify() {
    this._listeners.forEach(l => l());
  }

  register(listener: () => void) {
    this._listeners.push(listener);
  }

  private initialize() {
    const observer = new ResizeObserver(() => this.notify());

    const rootComponentRef = inject(ApplicationRef).components[0];
    const rootElement = rootComponentRef.location.nativeElement;
    observer.observe(rootElement, {});

    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }
}
