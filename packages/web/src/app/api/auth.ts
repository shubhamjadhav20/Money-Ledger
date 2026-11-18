import type { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

export const API_PREFIX = '/api';

/**
 * The API token for this tab. It lives in memory only: never in the URL, never in storage, never
 * logged. Reloading the page asks for it again. (A proper login with a cookie session replaces
 * this later; see PLAN.md.)
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly secret = signal<string | null>(null);
  private readonly limited = signal(false);

  readonly connected = computed(() => this.secret() !== null);

  /**
   * True for a capture-scope token: it can add quick entries and nothing else, so the app shows
   * only the quick-add screen. Set by Connect when the server refuses a read with 403.
   */
  readonly captureOnly = this.limited.asReadonly();

  connect(token: string, options: { readonly captureOnly?: boolean } = {}): void {
    this.secret.set(token.trim());
    this.limited.set(options.captureOnly === true);
  }

  disconnect(): void {
    this.secret.set(null);
    this.limited.set(false);
  }

  /** For the HTTP interceptor only. */
  bearer(): string | null {
    return this.secret();
  }
}

/** Adds the token to API calls, and only to API calls. */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(AuthStore).bearer();
  if (token === null || !request.url.startsWith(`${API_PREFIX}/`)) return next(request);
  return next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
