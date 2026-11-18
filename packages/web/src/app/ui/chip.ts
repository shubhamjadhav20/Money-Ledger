import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A toggle chip (category, payment method). `selected` is announced with aria-pressed, not just
 * shown with colour, so the state reads the same on a screen reader.
 */
@Component({
  selector: 'button[ui-chip]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.aria-pressed]': 'selected()', '[class.selected]': 'selected()' },
  template: '<ng-content />',
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      min-height: var(--tap-target);
      padding: 0 var(--space-4);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-pill);
      background: transparent;
      color: var(--color-text);
      font: inherit;
      font-size: var(--text-sm);
      cursor: pointer;
    }
    :host(:hover:not(.selected)) {
      background: var(--color-surface-2);
    }
    :host(.selected) {
      background: var(--color-accent-fill);
      border-color: var(--color-accent-fill);
      color: var(--color-on-accent);
      font-weight: var(--weight-medium);
    }
  `,
})
export class UiChip {
  readonly selected = input(false);
}
