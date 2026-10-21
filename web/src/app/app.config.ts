import { ApplicationConfig, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withViewTransitions,
} from '@angular/router';
import { ThemeService } from './core/theme.service';
import { TerraTitleStrategy, routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
      withViewTransitions({
        skipInitialTransition: true,
        onViewTransitionCreated: ({ transition, from, to }) => {
          // Query-param changes (tabs, filters) and reduced motion skip the page transition.
          const samePage = from.routeConfig === to.routeConfig;
          // (Dev builds log the resulting AbortError; that's Angular's ngDevMode logging, not a failure.)
          if (samePage || inject(ThemeService).reducedMotion()) transition.skipTransition();
        },
      }),
    ),
    { provide: TitleStrategy, useClass: TerraTitleStrategy },
  ],
};
