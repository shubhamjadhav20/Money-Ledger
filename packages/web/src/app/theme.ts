import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

export type ThemeChoice = 'system' | 'dark' | 'light';

export const THEME_STORAGE_KEY = 'ledger.theme';
const CHOICES: readonly ThemeChoice[] = ['system', 'dark', 'light'];

const isChoice = (value: unknown): value is ThemeChoice =>
  typeof value === 'string' && CHOICES.some((c) => c === value);

/**
 * The user's theme choice. `system` follows the OS (dark by default in tokens.css); the other two
 * are written to `data-theme` on <html>. The choice is a per-device convenience, kept in
 * localStorage when it is available and silently not kept when it is not.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  readonly choice = signal<ThemeChoice>(this.load());

  constructor() {
    effect(() => {
      const choice = this.choice();
      const root = this.document.documentElement;
      if (choice === 'system') delete root.dataset['theme'];
      else root.dataset['theme'] = choice;
      this.save(choice);
    });
  }

  set(choice: ThemeChoice): void {
    this.choice.set(choice);
  }

  private load(): ThemeChoice {
    try {
      const stored: unknown = this.document.defaultView?.localStorage.getItem(THEME_STORAGE_KEY);
      return isChoice(stored) ? stored : 'system';
    } catch {
      return 'system';
    }
  }

  private save(choice: ThemeChoice): void {
    try {
      this.document.defaultView?.localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch {
      // Storage can be blocked or full; the choice still applies for this session.
    }
  }
}
