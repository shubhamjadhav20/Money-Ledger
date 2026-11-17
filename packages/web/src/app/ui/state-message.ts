import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type StateKind = 'empty' | 'loading' | 'error';

/**
 * The three states every screen needs. `loading` is announced politely (role=status); `error` is
 * announced assertively (role=alert). Put a retry or primary action in the content slot.
 */
@Component({
  selector: 'ui-state-message',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'kind()',
    '[attr.role]': 'kind() === "error" ? "alert" : "status"',
    '[attr.aria-busy]': 'kind() === "loading" ? "true" : null',
  },
  template: `
    @if (kind() === 'loading') {
      <span class="skeleton" aria-hidden="true"></span>
    }
    <h3 class="title">{{ title() }}</h3>
    @if (description(); as text) {
      <p class="description">{{ text }}</p>
    }
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    :host {
      display: grid;
      justify-items: center;
      gap: var(--space-2);
      padding: var(--space-6) var(--space-4);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius-lg);
      text-align: center;
    }
    :host(.error) {
      border-style: solid;
      border-color: var(--color-negative);
    }
    .title {
      font-size: var(--text-lg);
    }
    .description {
      color: var(--color-text-muted);
      max-width: 40ch;
    }
    .actions:empty {
      display: none;
    }
    .actions {
      margin-top: var(--space-2);
    }
    .skeleton {
      width: 6rem;
      height: 0.75rem;
      border-radius: var(--radius-pill);
      background: linear-gradient(
        90deg,
        var(--color-surface-2),
        var(--color-surface-3),
        var(--color-surface-2)
      );
      background-size: 200% 100%;
      animation: shimmer var(--duration-slow) linear infinite alternate;
    }
    @keyframes shimmer {
      from {
        background-position: 0 0;
      }
      to {
        background-position: 100% 0;
      }
    }
  `,
})
export class UiStateMessage {
  readonly kind = input.required<StateKind>();
  readonly title = input.required<string>();
  readonly description = input<string>();
}
