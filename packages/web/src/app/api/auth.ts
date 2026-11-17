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

  readonly connected = computed(() => this.secret() !== null);

  connect(token: string): void {
    this.secret.set(token.trim());
  }

  disconnect(): void {
    this.secret.set(null);
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
