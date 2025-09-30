import {provideServerRendering, RenderMode, withRoutes} from '@angular/ssr';
import {mergeApplicationConfig, ApplicationConfig} from '@angular/core';
import {appConfig} from './app.config';

const ssrAppConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(
      withRoutes([
        {
          // We don't need any pre-rendering.
          path: '**',
          renderMode: RenderMode.Server,
        },
      ]),
    ),
  ],
};

export const serverConfig = mergeApplicationConfig(appConfig, ssrAppConfig);
