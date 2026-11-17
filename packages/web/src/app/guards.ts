import { inject } from '@angular/core';
import { Router } from '@angular/router';
import type { CanActivateFn } from '@angular/router';
import { AuthStore } from './api/auth';

/** Screens that read the ledger need a token first. */
export const connectedOnly: CanActivateFn = () =>
  inject(AuthStore).connected() ? true : inject(Router).parseUrl('/connect');

/** The connect screen is pointless once connected. */
export const disconnectedOnly: CanActivateFn = () =>
  inject(AuthStore).connected() ? inject(Router).parseUrl('/dashboard') : true;

/** Screens that need a token. If the token is lost while on one of these, go back to Connect. */
export const PROTECTED_PREFIXES = ['/dashboard', '/transactions', '/import'] as const;
