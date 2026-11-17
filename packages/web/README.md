# @ledger/web

The Angular app: dashboard, import, transactions, reconcile, pots and quick-add. It talks to the API
(`packages/api`) with scoped tokens only and never holds database credentials.

Angular 22 (needs Node 24.15 or newer), standalone components, Signals, zoneless, `OnPush` everywhere,
plain CSS with design tokens, Vitest for unit tests. Money is integer paise end to end and is
formatted by `@ledger/core`, the same code the API uses.

```
pnpm --filter @ledger/web start   # dev server on http://localhost:4200
pnpm --filter @ledger/web test    # unit tests (jsdom, no browser needed)
pnpm --filter @ledger/web build   # production build into packages/web/dist
```

## Layout

- `src/styles/tokens.css`: every colour, size, radius and duration. Dark first; light follows the OS
  or the user's choice. `tokens.spec.ts` checks the contrast of every text/surface pair (WCAG AA).
- `src/styles/base.css`: reset, focus ring, `tabular-nums` for money, reduced-motion.
- `src/app/ui/`: the small component set (`ui-money`, `ui-card`, `ui-badge`, `ui-state-message`,
  `button[ui-button]`, `button[ui-chip]`). Screens are built from these.
- `src/app/gallery/`: `/gallery` shows all of them in both themes with made-up data.
- `src/app/theme.ts`: the theme choice (signal), remembered per device when storage allows.

## Rules for new code

- Components are `ChangeDetectionStrategy.OnPush`, use `inject()`, `@if` / `@for`, and signals for
  state. No manual subscriptions where a signal works. `ng generate` is configured for OnPush.
- No literal colours or sizes in components: use the tokens.
- Amounts always render through `ui-money`. Never `innerHTML`: memos and counterparties are
  untrusted text.
- State is never carried by colour alone (the text says "posted", the sign is in the number).
