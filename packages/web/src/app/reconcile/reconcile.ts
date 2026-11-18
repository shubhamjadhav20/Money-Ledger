import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { UnmatchedReason } from '../api/models';
import { formatDay } from '../format';
import { formatMonth } from '../month';
import { UiBadge } from '../ui/badge';
import { UiButton } from '../ui/button';
import { UiIcon } from '../ui/icon';
import { UiCard } from '../ui/card';
import { UiMoney } from '../ui/money';
import { UiStateMessage } from '../ui/state-message';
import { ReconcileStore } from './reconcile-store';

const REVIEW_TEXT: Readonly<Record<UnmatchedReason, string>> = {
  ambiguous:
    'These could be matched in more than one way, so nothing has been guessed. None of them is netted.',
  'group-too-large':
    'There are too many similar payments here to pair up safely. None of them is netted.',
};

/**
 * Purchases and refunds, or a friend's share and the payment it covered, matched so that what you
 * really spent is counted once. This screen only shows the matches; it changes nothing.
 */
@Component({
  selector: 'app-reconcile',
  imports: [RouterLink, UiBadge, UiButton, UiCard, UiMoney, UiStateMessage, UiIcon],
  providers: [ReconcileStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reconcile.html',
  styleUrl: './reconcile.css',
})
export class Reconcile {
  protected readonly store = inject(ReconcileStore);

  protected readonly formatDay = formatDay;
  protected readonly reviewText = REVIEW_TEXT;
  protected readonly monthLabel = computed(() => formatMonth(this.store.month()));

  constructor() {
    void this.store.load();
  }

  protected reload(): void {
    void this.store.load();
  }
}
