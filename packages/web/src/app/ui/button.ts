import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** `<button ui-button variant="primary">Save</button>`: styles a real <button>, so keyboard and form behaviour come free. */
@Component({
  selector: 'button[ui-button]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"btn " + variant()' },
  template: '<ng-content />',
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      min-height: var(--tap-target);
      padding: 0 var(--space-4);
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      font: inherit;
      font-weight: var(--weight-medium);
      cursor: pointer;
      transition: background-color var(--duration-fast) var(--ease);
    }
    :host(.primary) {
      background: var(--color-accent);
      color: var(--color-on-accent);
    }
    :host(.primary:hover:not(:disabled)) {
      filter: brightness(1.08);
    }
    :host(.secondary) {
      background: var(--color-surface-2);
      color: var(--color-text);
      border-color: var(--color-border-strong);
    }
    :host(.secondary:hover:not(:disabled)),
    :host(.ghost:hover:not(:disabled)) {
      background: var(--color-surface-3);
    }
    :host(.ghost) {
      background: transparent;
      color: var(--color-text);
    }
    :host(.danger) {
      background: transparent;
      color: var(--color-negative);
      border-color: var(--color-negative);
    }
    :host(.danger:hover:not(:disabled)) {
      background: var(--color-surface-2);
    }
    :host(:disabled) {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `,
})
export class UiButton {
  readonly variant = input<ButtonVariant>('secondary');
}
