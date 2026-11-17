# Ledger

Personal finance ledger: import bank/card statements, reconcile messy transactions, track pots and payday allocations, forecast spend to next payday, and ask Claude "can I afford X?" through a local MCP server.

> Work in progress. See [PLAN.md](PLAN.md) for scope and milestones. The full README (architecture diagram, demo GIF, design decisions) lands in M7.

## Requirements

- Node 24 (see `.nvmrc`; Angular in M5 needs `>=24.15`)
- pnpm via corepack: `corepack enable pnpm` (version pinned in `package.json`)

## Commands

```sh
pnpm install        # also enables the pre-commit hook (.githooks/)
pnpm check          # lint + format check + typecheck + test + build
pnpm test           # vitest
pnpm lint           # eslint (type-aware)
pnpm typecheck      # tsc per package
pnpm format         # prettier --write
```

## Layout

```
packages/core    pure domain logic, no I/O
packages/api     Express + Postgres (M4)
packages/tools   tool definitions, written once (M6)
packages/mcp     local stdio MCP server (M6)
packages/web     Angular app (M5, placeholder for now)
```

## Data safety

No real financial data is ever committed. `.gitignore` and the pre-commit hook block statement files outside `fixtures/`; gitleaks runs locally (if installed) and in CI.
