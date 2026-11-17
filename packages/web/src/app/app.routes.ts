import type { Routes } from '@angular/router';
import { connectedOnly, disconnectedOnly } from './guards';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'connect',
    title: 'Connect · Ledger',
    canActivate: [disconnectedOnly],
    loadComponent: () => import('./connect/connect').then((m) => m.Connect),
  },
  {
    path: 'dashboard',
    title: 'Dashboard · Ledger',
    canActivate: [connectedOnly],
    loadComponent: () => import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'transactions',
    title: 'Transactions · Ledger',
    canActivate: [connectedOnly],
    loadComponent: () => import('./transactions/transactions').then((m) => m.Transactions),
  },
  {
    path: 'import',
    title: 'Import · Ledger',
    canActivate: [connectedOnly],
    loadComponent: () => import('./import/import-screen').then((m) => m.ImportScreen),
  },
  {
    path: 'reconcile',
    title: 'Reconcile · Ledger',
    canActivate: [connectedOnly],
    loadComponent: () => import('./reconcile/reconcile').then((m) => m.Reconcile),
  },
  {
    path: 'pots',
    title: 'Pots · Ledger',
    canActivate: [connectedOnly],
    loadComponent: () => import('./pots/pots').then((m) => m.Pots),
  },
  {
    path: 'gallery',
    title: 'Component gallery · Ledger',
    loadComponent: () => import('./gallery/gallery').then((m) => m.Gallery),
  },
  { path: '**', redirectTo: 'dashboard' },
];
