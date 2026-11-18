/**
 * What a tool needs from the ledger. The MCP server, the Telegram bot and the later agent each
 * implement `LedgerService` by calling the API with a scoped token; no adapter touches the
 * database. The `*Wire` schemas describe the API's JSON: an implementation parses every response
 * with them, so a field that goes missing or changes type fails loudly instead of showing a wrong
 * amount. Unknown extra fields are dropped.
 */
import { TX_KINDS } from '@ledger/core';
import { z } from 'zod';

const paiseField = z.number().int();
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const potWire = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['buffer', 'bill', 'spend']),
  balancePaise: paiseField,
  // The API leaves these keys out when a pot has no target or no due date.
  targetPaise: paiseField.nullish(),
  dueDate: dateField.nullish(),
});
export const potsWire = z.object({ items: z.array(potWire) });
export type PotWire = z.infer<typeof potWire>;

export const freeWire = z.object({
  freePaise: paiseField,
  nextPayday: dateField,
  daysToPayday: z.number().int(),
  lines: z.array(z.object({ label: z.string(), amountPaise: paiseField })),
  balances: z.array(
    z.object({
      accountId: z.string(),
      name: z.string(),
      kind: z.enum(['bank', 'card', 'savings', 'cash']),
      balancePaise: paiseField,
      asOf: dateField,
    }),
  ),
  warnings: z.array(z.string()),
});
export type FreeWire = z.infer<typeof freeWire>;

export const ESTIMATORS = ['mean', 'median', 'trimmed-mean'] as const;
export const forecastWire = z.object({
  freePaise: paiseField,
  nextPayday: dateField,
  windowDays: z.number().int(),
  estimator: z.enum(ESTIMATORS),
  burnPaisePerDay: paiseField,
  daysToPayday: z.number().int(),
  projectedFreePaise: paiseField,
  runwayDays: z.number().int().nullable(),
});
export type ForecastWire = z.infer<typeof forecastWire>;

export const transactionWire = z.object({
  id: z.string(),
  accountId: z.string(),
  date: dateField,
  amountPaise: paiseField,
  counterparty: z.string(),
  memo: z.string(),
  category: z.string().nullable(),
  kind: z.enum(TX_KINDS),
  method: z.string().nullable(),
  status: z.enum(['pending', 'posted']),
});
export const transactionsWire = z.object({ items: z.array(transactionWire) });
export type TransactionWire = z.infer<typeof transactionWire>;

export const reconcileWire = z.object({
  from: dateField,
  to: dateField,
  bundles: z.array(
    z.object({
      id: z.string(),
      txIds: z.array(z.string()),
      netPaise: paiseField,
      status: z.enum(['settled', 'open']),
      reason: z.string(),
      score: z.number(),
    }),
  ),
  unmatched: z.array(
    z.object({
      txId: z.string(),
      reason: z.enum(['ambiguous', 'group-too-large']),
      relatedTxIds: z.array(z.string()),
    }),
  ),
  singleCount: z.number().int(),
  transactions: z.record(
    z.string(),
    z.object({
      id: z.string(),
      accountId: z.string(),
      date: dateField,
      amountPaise: paiseField,
      counterparty: z.string(),
    }),
  ),
});
export type ReconcileWire = z.infer<typeof reconcileWire>;

export const SIMULATE_METHODS = ['upi', 'card', 'slice_in_3'] as const;
export const simulateWire = z.object({
  method: z.string(),
  affordableNow: z.boolean(),
  freeAfterPaise: paiseField,
  installments: z.array(
    z.object({
      number: z.number().int(),
      statementDate: dateField,
      dueDate: dateField,
      amountPaise: paiseField,
    }),
  ),
  cardCharge: z
    .object({ statementDate: dateField, dueDate: dateField, amountPaise: paiseField })
    .optional(),
  warnings: z.array(z.string()),
  assumptions: z.array(z.string()),
});
export type SimulateWire = z.infer<typeof simulateWire>;

export const summaryWire = z.object({
  month: z.string(),
  byKind: z.record(z.string(), z.object({ netPaise: paiseField, count: z.number().int() })),
  incomePaise: paiseField,
  investedPaise: paiseField,
  familyPaise: paiseField,
  spendPaise: paiseField,
  fixedSpendPaise: paiseField,
  variableSpendPaise: paiseField,
  leftoverPaise: paiseField,
  spendByCategory: z.array(
    z.object({ category: z.string(), spentPaise: paiseField, fixed: z.boolean() }),
  ),
});
export type SummaryWire = z.infer<typeof summaryWire>;

export const captureWire = z.object({
  id: z.string(),
  entry: z.object({
    date: dateField,
    amountPaise: paiseField,
    method: z.string(),
    category: z.string().nullable().optional(),
    kind: z.enum(TX_KINDS),
    memo: z.string(),
    status: z.enum(['pending', 'posted']),
  }),
});
export type CaptureWire = z.infer<typeof captureWire>;

export interface TransactionsQuery {
  readonly from?: string;
  readonly to?: string;
  readonly category?: string;
  readonly status?: 'pending' | 'posted';
  readonly q?: string;
  readonly limit: number;
}

export interface SimulateQuery {
  readonly amountPaise: number;
  readonly method: (typeof SIMULATE_METHODS)[number];
  readonly cardAccountId?: string;
}

export interface LedgerService {
  pots(): Promise<PotWire[]>;
  free(): Promise<FreeWire>;
  transactions(query: TransactionsQuery): Promise<TransactionWire[]>;
  reconcile(range: { readonly from: string; readonly to: string }): Promise<ReconcileWire>;
  forecast(query: {
    readonly windowDays?: number;
    readonly estimator?: (typeof ESTIMATORS)[number];
  }): Promise<ForecastWire>;
  simulate(query: SimulateQuery): Promise<SimulateWire>;
  summary(month: string): Promise<SummaryWire>;
  /** The one write: creates a pending manual entry. Implementations need a `capture` token. */
  capture(input: { readonly text: string; readonly accountId?: string }): Promise<CaptureWire>;
}

/** A failure a tool can show to the person: bad input, a rejected token, missing balances. */
export class LedgerError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    this.status = status;
  }
}
