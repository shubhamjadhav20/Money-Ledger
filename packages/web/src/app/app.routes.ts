import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'gallery' },
  {
    path: 'gallery',
    title: 'Component gallery · Ledger',
    loadComponent: () => import('./gallery/gallery').then((m) => m.Gallery),
  },
  { path: '**', redirectTo: 'gallery' },
];
