import { inject } from '@angular/core';
import { Router } from '@angular/router';
import type { CanActivateFn } from '@angular/router';
import { AuthStore } from './api/auth';

/** Screens that read the ledger need a token that can read. A capture-only token goes to quick-add. */
export const connectedOnly: CanActivateFn = () => {
  const auth = inject(AuthStore);
  if (!auth.connected()) return inject(Router).parseUrl('/connect');
  return auth.captureOnly() ? inject(Router).parseUrl('/quick-add') : true;
};

/** Quick-add works with any token that is connected (the server decides what it may add). */
export const signedIn: CanActivateFn = () =>
  inject(AuthStore).connected() ? true : inject(Router).parseUrl('/connect');

/** The connect screen is pointless once connected. */
export const disconnectedOnly: CanActivateFn = () => {
  const auth = inject(AuthStore);
  if (!auth.connected()) return true;
  return inject(Router).parseUrl(auth.captureOnly() ? '/quick-add' : '/dashboard');
};

/** Screens that need a token. If the token is lost while on one of these, go back to Connect. */
export const PROTECTED_PREFIXES = [
  '/dashboard',
  '/transactions',
  '/import',
  '/reconcile',
  '/pots',
  '/payday',
  '/quick-add',
] as const;
