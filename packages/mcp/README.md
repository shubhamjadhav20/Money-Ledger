# @ledger/mcp

A local MCP server over stdio. Your AI app (Claude Desktop, Claude Code) starts it; it asks the Ledger
API your questions with a scoped token and returns the answers. It never touches the database and
never opens a port. The tools themselves live in `@ledger/tools`.

Built on `@modelcontextprotocol/server` 2.4.0. Needs Node 24.15 or newer (the repository runs its
TypeScript directly, with no build step).

## Tools, resource, prompt

| Name | Needs | What it does |
|---|---|---|
| `get_free_to_spend`, `get_pots`, `list_transactions`, `reconcile_month`, `forecast_to_payday`, `simulate_purchase` | `read` token | Read only. `simulate_purchase` records nothing. |
| `add_transaction` | `LEDGER_MCP_WRITE=1` and a `capture` token | Adds one pending entry. Needs `confirm: true` in the call. Not in the tool list otherwise. |
| resource `ledger://summary/YYYY-MM` | `read` token | Income, spend, invested, family and leftover for a month. |
| prompt `payday_checklist` | `read` token | A ready-made walk through the payday numbers. |

## Settings (environment variables)

| Variable | Required | Meaning |
|---|---|---|
| `LEDGER_API_URL` | no | Where the API listens. Default `http://127.0.0.1:3000`. Must be `https://` unless it is this computer. |
| `LEDGER_API_TOKEN` | yes | A token with scope `read`. Used by every read tool. |
| `LEDGER_MCP_WRITE` | no | `1` offers `add_transaction`. Unset, empty or `0` means read only. Anything else stops the server. |
| `LEDGER_CAPTURE_TOKEN` | with `LEDGER_MCP_WRITE=1` | A token with scope `capture`, different from the read token. Used only by `add_transaction`. |

A wrong setting stops the server with a message on stderr. No message ever contains a token.

## Set it up

1. Run the API (see `docs/HOW-IT-WORKS.md`, section 9) and record each account's current balance in
   the web app, so free-to-spend can be worked out.
2. Create the token(s). Each prints its secret once:

   ```
   pnpm --filter @ledger/api admin create-token --name claude-read --scope read
   pnpm --filter @ledger/api admin create-token --name claude-capture --scope capture   # only for add_transaction
   ```

3. Tell your AI app how to start the server. Use the full path to `serve.ts`.

   **Claude Code** (the `--` separates Claude Code's options from the server command; syntax
   checked against the Claude Code docs). Use the default `local` scope or `--scope user`.
   Never `--scope project`: that writes the token into `.mcp.json`, which is committed.

   ```
   claude mcp add --env LEDGER_API_TOKEN=led_xxx --transport stdio ledger -- node /path/to/Money-Ledger/packages/mcp/src/bin/serve.ts
   ```

   **Claude Desktop** (Settings, Developer, Edit Config opens `claude_desktop_config.json`; this
   path and layout are from memory, not re-checked):

   ```json
   {
     "mcpServers": {
       "ledger": {
         "command": "node",
         "args": ["C:\\path\\to\\Money-Ledger\\packages\\mcp\\src\\bin\\serve.ts"],
         "env": { "LEDGER_API_TOKEN": "led_xxx" }
       }
     }
   }
   ```

   To offer `add_transaction`, add `"LEDGER_MCP_WRITE": "1"` and `"LEDGER_CAPTURE_TOKEN": "led_yyy"`
   to `env`.

4. Ask: "Can I buy a ₹2,300 item on Slice in 3?" It calls `simulate_purchase` and answers from your
   real numbers.

## Rules this server keeps

- stdout carries the protocol and nothing else. Logs go to stderr and contain only tool names and
  error codes: no amounts, memos, counterparties or tokens.
- Merchant names and memos are left out of results unless the tool is called with `includeText`, and
  then they are shortened and stripped of control and invisible characters. They are data, never
  instructions.
- Read and write use different tokens. The API stays the only place that checks scope, rate limits
  and the audit log.
- A redirect from the API is never followed, and a token is never sent over plain `http://` to
  another computer.

## Develop

```
pnpm --filter @ledger/mcp start    # needs the settings above in the environment
pnpm test                          # includes the end-to-end test that starts this server
```

`src/e2e.test.ts` runs the real API on an in-memory Postgres and this server as a child process,
speaking JSON-RPC over stdio. It is the best place to see exactly what a client sees.
