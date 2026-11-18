import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type BadgeTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info';

/** A small status label. The text always says the status; the colour only reinforces it. */
@Component({
  selector: 'ui-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'tone()' },
  template: '<ng-content />',
  styles: `
    :host {
      display: inline-block;
      padding: 0.0625rem var(--space-2);
      border-radius: var(--radius-pill);
      background: color-mix(in srgb, currentColor 9%, transparent);
      font-size: var(--text-xs);
      font-weight: var(--weight-bold);
      line-height: 1.5;
      white-space: nowrap;
    }
    :host(.neutral) {
      color: var(--color-text-muted);
    }
    :host(.positive) {
      color: var(--color-positive);
    }
    :host(.negative) {
      color: var(--color-negative);
    }
    :host(.warning) {
      color: var(--color-warning);
    }
    :host(.info) {
      color: var(--color-accent);
    }
  `,
})
export class UiBadge {
  readonly tone = input<BadgeTone>('neutral');
}
