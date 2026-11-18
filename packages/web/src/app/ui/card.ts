import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A surface that groups related content. Headings and layout go inside. */
@Component({
  selector: 'ui-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  styles: `
    :host {
      display: block;
      padding: var(--space-5);
      background: var(--color-surface-1);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-1);
    }
    @media (max-width: 30rem) {
      :host {
        padding: var(--space-4);
      }
    }
  `,
})
export class UiCard {}
