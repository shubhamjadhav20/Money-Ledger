import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { paise } from '@ledger/core';
import { ThemeService } from '../theme';
import type { ThemeChoice } from '../theme';
import { UiBadge } from '../ui/badge';
import { UiButton } from '../ui/button';
import { UiCard } from '../ui/card';
import { UiChip } from '../ui/chip';
import { UiIcon } from '../ui/icon';
import { UiMoney } from '../ui/money';
import { UiStateMessage } from '../ui/state-message';
import { Runway } from '../dashboard/runway';

/** Fake sample rows only: the gallery never touches the API or real data. */
const SAMPLE_ROWS = [
  { id: 't1', date: '2026-11-16', who: 'UPI/JACOB CAFE', amount: paise(-45_000), status: 'posted' },
  { id: 't2', date: '2026-11-15', who: 'SALARY ACME', amount: paise(4_870_000), status: 'posted' },
  { id: 't3', date: '2026-11-14', who: 'Chai (cash)', amount: paise(-2_000), status: 'pending' },
  { id: 't4', date: '2026-11-13', who: 'UPI/ZETA TRADERS', amount: paise(50_000), status: 'open' },
] as const;

const SWATCHES = [
  'bg',
  'surface-1',
  'surface-2',
  'surface-3',
  'border-strong',
  'text',
  'text-muted',
  'accent',
  'accent-fill',
  'hero',
  'on-hero',
  'hero-accent',
  'positive',
  'negative',
  'warning',
] as const;

const ICONS = [
  'home',
  'list',
  'upload',
  'match',
  'pots',
  'plus',
  'logout',
  'left',
  'right',
  'alert',
] as const;

const CATEGORIES = ['Food', 'Travel', 'Bills', 'Shopping', 'Health'] as const;
const METHODS = ['UPI', 'Card', 'Cash'] as const;

@Component({
  selector: 'app-gallery',
  imports: [Runway, UiBadge, UiButton, UiCard, UiChip, UiIcon, UiMoney, UiStateMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gallery.html',
  styleUrl: './gallery.css',
})
export class Gallery {
  protected readonly theme = inject(ThemeService);

  protected readonly rows = SAMPLE_ROWS;
  protected readonly swatches = SWATCHES;
  protected readonly icons = ICONS;
  protected readonly categories = CATEGORIES;
  protected readonly methods = METHODS;
  protected readonly themes: readonly ThemeChoice[] = ['system', 'dark', 'light'];

  protected readonly category = signal<string>('Food');
  protected readonly method = signal<string>('UPI');

  protected readonly freeToSpend = paise(838_100);
  protected readonly daysToPayday = 20;
  protected readonly potBalance = paise(250_000);
  protected readonly potTarget = paise(250_000);

  protected readonly samples = {
    big: paise(12_345_678),
    small: paise(5),
    owed: paise(-76_900),
    zero: paise(0),
    refund: paise(70_000),
  } as const;

  protected badgeTone(status: string): 'neutral' | 'positive' | 'warning' {
    return status === 'posted' ? 'positive' : status === 'pending' ? 'neutral' : 'warning';
  }
}
