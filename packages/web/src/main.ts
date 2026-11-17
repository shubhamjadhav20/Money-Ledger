import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((error: unknown) => {
  // The bootstrap error is about the app itself (never about ledger data), so it is safe to show.
  // eslint-disable-next-line no-console
  console.error(error);
});
