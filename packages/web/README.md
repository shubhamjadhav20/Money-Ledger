# @ledger/web

The Angular app: dashboard, import, transactions, reconcile, pots and quick-add. It talks to the API
(`packages/api`) with scoped tokens only and never holds database credentials.

Angular 22 (needs Node 24.15 or newer), standalone components, Signals, zoneless, `OnPush` everywhere,
plain CSS with design tokens, Vitest for unit tests. Money is integer paise end to end and is
formatted by `@ledger/core`, the same code the API uses.

```
pnpm --filter @ledger/web start   # dev server on http://localhost:4200 (forwards /api to the API on :3000)
pnpm --filter @ledger/web test    # unit tests (jsdom, no browser needed)
pnpm --filter @ledger/web build   # production build into packages/web/dist
```

## Layout

- `src/styles/tokens.css`: every colour, size, radius and duration. Dark first; light follows the OS
  or the user's choice. `tokens.spec.ts` checks the contrast of every text/surface pair (WCAG AA).
- `src/styles/fonts.css` and `public/fonts/`: the two self-hosted font families and their licences.
  Third-party notices (fonts, icons) are in `THIRD-PARTY.md`.
- `src/styles/base.css`: reset, focus ring, `tabular-nums` for money, the shared progress-bar and
  file-picker styles, reduced-motion.
- `src/app/ui/`: the small component set (`ui-money`, `ui-card`, `ui-badge`, `ui-icon`,
  `ui-state-message`, `button[ui-button]`, `button[ui-chip]`). Screens are built from these.
- `src/app/gallery/`: `/gallery` shows all of them in both themes with made-up data.
- `src/app/theme.ts`: the theme choice (signal), remembered per device when storage allows.
- `src/app/api/`: the API client. `decode.ts` / `models.ts` check every response (money must be a safe
  integer, dates real calendar dates) before it reaches a screen; `api-client.ts` turns failures into
  one `ApiError` shape; `auth.ts` keeps the token in memory only and adds it to `/api/` calls only.
- `src/app/connect/`: `/connect`, where an API token is pasted (interim, until the cookie-session login).
- `src/app/dashboard/`: `/dashboard`, its store (`DashboardStore`), the payday runway drawing
  (`runway.ts`), the schedule expansion and the starting-balances form.
- `src/app/transactions/`: `/transactions`, its store (`TransactionsStore`), the edit form and the
  kind/method/status labels. `src/app/month.ts` has the month helpers.
- `src/app/import/`: `/import`, its store (`ImportStore`: the file lives only here), the screen with the
  ambiguity picker. Statement layouts come from core's `DEMO_MAPPINGS`.
- `src/app/pots/`: `/pots`, its store (`PotsStore`), the pot form (create and edit), the move-money form
  and the labels.
- `src/app/reconcile/`: `/reconcile` (read only), its store (`ReconcileStore`) and `grouping.ts`, which
  turns the API's bundles and review queue into the cards the screen shows.
- `src/app/guards.ts`: `connectedOnly` / `disconnectedOnly` route guards.
- `proxy.conf.json`: the dev proxy. The API has no CORS, so the browser talks to `/api/...` on the
  dev server, which strips the prefix and forwards to `127.0.0.1:3000`.
- `src/testing.ts`, `src/testing-api.ts`: spec-only helpers and fake API data (excluded from the app build).

To see it with data: start the API (`docs/HOW-IT-WORKS.md` section 9), create a token with
`pnpm --filter @ledger/api admin create-token --name laptop --scope full`, run `pnpm --filter @ledger/web start`, and paste the
token on the Connect screen.

## Rules for new code

- Components are `ChangeDetectionStrategy.OnPush`, use `inject()`, `@if` / `@for`, and signals for
  state. No manual subscriptions where a signal works. `ng generate` is configured for OnPush.
- No literal colours or sizes in components: use the tokens.
- Amounts always render through `ui-money`. Never `innerHTML`: memos and counterparties are
  untrusted text.
- State is never carried by colour alone (the text says "posted", the sign is in the number).
