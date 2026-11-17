import { PAYMENT_METHODS, TX_KINDS } from '@ledger/core';
import type { LocalDate, Paise, PaymentMethod, TxKind } from '@ledger/core';
import { day, flag, int, list, money, nullable, oneOf, record, text } from './decode';

export interface FreeLine {
  readonly label: string;
  readonly amountPaise: Paise;
}

export interface CardCycleView {
  readonly statementDay: number;
  readonly dueDay: number;
}

export type AccountKind = 'bank' | 'card' | 'savings' | 'cash';

export interface AccountBalanceView {
  readonly accountId: string;
  readonly name: string;
  readonly kind: AccountKind;
  /** Null until a balance has been recorded for this account. */
  readonly balancePaise: Paise | null;
  readonly asOf: LocalDate | null;
  readonly cycle: CardCycleView | null;
}

export interface FreeView {
  readonly freePaise: Paise;
  readonly nextPayday: LocalDate;
  readonly daysToPayday: number;
  readonly lines: readonly FreeLine[];
  readonly balances: readonly AccountBalanceView[];
  readonly warnings: readonly string[];
}

export interface MissingAccount {
  readonly accountId: string;
  readonly name: string;
}

export interface ForecastView {
  readonly burnPaisePerDay: Paise;
  readonly daysToPayday: number;
  readonly projectedFreePaise: Paise;
  /** Whole days the free money lasts at this burn; null when nothing is being spent. */
  readonly runwayDays: number | null;
  readonly windowDays: number;
}

export type PotKind = 'buffer' | 'bill' | 'spend';

export interface PotView {
  readonly id: string;
  readonly name: string;
  readonly kind: PotKind;
  readonly balancePaise: Paise;
  readonly targetPaise: Paise | null;
  readonly dueDate: LocalDate | null;
  /** For a card-bill pot: the card it pays. */
  readonly coversCardAccountId: string | null;
}

export const MOVEMENT_REASONS = ['payday', 'spend', 'trueup', 'manual'] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

/** One line of a pot's journal. Positive puts money in, negative takes it out. */
export interface PotMovementView {
  readonly id: string;
  readonly amountPaise: Paise;
  readonly reason: MovementReason;
  readonly date: LocalDate;
}

export interface ScheduledView {
  readonly id: string;
  readonly name: string;
  readonly amountPaise: Paise;
  readonly date: LocalDate | null;
  readonly monthlyDay: number | null;
}

const ACCOUNT_KINDS = ['bank', 'card', 'savings', 'cash'] as const;
export const POT_KINDS = ['buffer', 'bill', 'spend'] as const;

export function decodeAccountBalance(value: unknown): AccountBalanceView {
  const r = record(value, 'balance');
  return {
    accountId: text(r['accountId'], 'balance.accountId'),
    name: text(r['name'], 'balance.name'),
    kind: oneOf(r['kind'], ACCOUNT_KINDS, 'balance.kind'),
    balancePaise: nullable(r['balancePaise'], (v) => money(v, 'balance.balancePaise')),
    asOf: nullable(r['asOf'], (v) => day(v, 'balance.asOf')),
    cycle: nullable(r['cycle'], (v) => {
      const c = record(v, 'balance.cycle');
      return {
        statementDay: int(c['statementDay'], 'cycle.statementDay'),
        dueDay: int(c['dueDay'], 'cycle.dueDay'),
      };
    }),
  };
}

export const decodeBalances = (value: unknown): AccountBalanceView[] =>
  list(record(value, 'balances')['items'], 'balances.items').map(decodeAccountBalance);

export function decodeFree(value: unknown): FreeView {
  const r = record(value, 'free');
  return {
    freePaise: money(r['freePaise'], 'free.freePaise'),
    nextPayday: day(r['nextPayday'], 'free.nextPayday'),
    daysToPayday: int(r['daysToPayday'], 'free.daysToPayday'),
    lines: list(r['lines'], 'free.lines').map((line) => {
      const l = record(line, 'free.lines[]');
      return {
        label: text(l['label'], 'line.label'),
        amountPaise: money(l['amountPaise'], 'line.amountPaise'),
      };
    }),
    balances: list(r['balances'], 'free.balances').map(decodeAccountBalance),
    warnings: list(r['warnings'], 'free.warnings').map((w) => text(w, 'free.warnings[]')),
  };
}

export const decodeMissing = (details: unknown): MissingAccount[] =>
  list(details, 'details').map((item) => {
    const m = record(item, 'details[]');
    return { accountId: text(m['accountId'], 'accountId'), name: text(m['name'], 'name') };
  });

export function decodeForecast(value: unknown): ForecastView {
  const r = record(value, 'forecast');
  return {
    burnPaisePerDay: money(r['burnPaisePerDay'], 'forecast.burnPaisePerDay'),
    daysToPayday: int(r['daysToPayday'], 'forecast.daysToPayday'),
    projectedFreePaise: money(r['projectedFreePaise'], 'forecast.projectedFreePaise'),
    runwayDays: nullable(r['runwayDays'], (v) => int(v, 'forecast.runwayDays')),
    windowDays: int(r['windowDays'], 'forecast.windowDays'),
  };
}

export function decodePot(value: unknown): PotView {
  const p = record(value, 'pot');
  return {
    id: text(p['id'], 'pot.id'),
    name: text(p['name'], 'pot.name'),
    kind: oneOf(p['kind'], POT_KINDS, 'pot.kind'),
    balancePaise: money(p['balancePaise'], 'pot.balancePaise'),
    targetPaise: nullable(p['targetPaise'], (v) => money(v, 'pot.targetPaise')),
    dueDate: nullable(p['dueDate'], (v) => day(v, 'pot.dueDate')),
    coversCardAccountId: nullable(p['coversCardAccountId'], (v) =>
      text(v, 'pot.coversCardAccountId'),
    ),
  };
}

export const decodePots = (value: unknown): PotView[] =>
  list(record(value, 'pots')['items'], 'pots.items').map(decodePot);

export const decodePotMovements = (value: unknown): PotMovementView[] =>
  list(record(value, 'pot movements')['items'], 'pot movements.items').map((item) => {
    const m = record(item, 'pot movement');
    return {
      id: text(m['id'], 'movement.id'),
      amountPaise: money(m['amountPaise'], 'movement.amountPaise'),
      reason: oneOf(m['reason'], MOVEMENT_REASONS, 'movement.reason'),
      date: day(m['date'], 'movement.date'),
    };
  });

/** The `{ id }` the API answers a create with. */
export const decodeCreatedId = (value: unknown): string =>
  text(record(value, 'created')['id'], 'id');

export const decodeScheduled = (value: unknown): ScheduledView[] =>
  list(record(value, 'scheduled')['items'], 'scheduled.items').map((item) => {
    const s = record(item, 'scheduled item');
    return {
      id: text(s['id'], 'scheduled.id'),
      name: text(s['name'], 'scheduled.name'),
      amountPaise: money(s['amountPaise'], 'scheduled.amountPaise'),
      date: nullable(s['date'], (v) => day(v, 'scheduled.date')),
      monthlyDay: nullable(s['monthlyDay'], (v) => int(v, 'scheduled.monthlyDay')),
    };
  });

export type TxStatus = 'pending' | 'posted';
export type TxSource = 'manual' | 'import' | 'sms';

export interface TransactionView {
  readonly id: string;
  readonly accountId: string;
  readonly date: LocalDate;
  /** Signed: money out is negative. */
  readonly amountPaise: Paise;
  readonly counterparty: string;
  readonly memo: string;
  readonly category: string | null;
  readonly kind: TxKind;
  readonly method: PaymentMethod;
  readonly status: TxStatus;
  readonly source: TxSource;
}

export interface CategorySpend {
  readonly category: string;
  readonly spentPaise: Paise;
  readonly fixed: boolean;
}

export interface SummaryView {
  readonly month: string;
  readonly incomePaise: Paise;
  readonly spendPaise: Paise;
  readonly investedPaise: Paise;
  readonly familyPaise: Paise;
  readonly fixedSpendPaise: Paise;
  readonly variableSpendPaise: Paise;
  /** income - invested - family - spend; negative when more went out than came in. */
  readonly leftoverPaise: Paise;
  /** Transfers between your own accounts: counted here, never as spend. */
  readonly transferCount: number;
  readonly spendByCategory: readonly CategorySpend[];
}

const TX_STATUSES = ['pending', 'posted'] as const;
const TX_SOURCES = ['manual', 'import', 'sms'] as const;

export function decodeTransaction(value: unknown): TransactionView {
  const t = record(value, 'transaction');
  return {
    id: text(t['id'], 'transaction.id'),
    accountId: text(t['accountId'], 'transaction.accountId'),
    date: day(t['date'], 'transaction.date'),
    amountPaise: money(t['amountPaise'], 'transaction.amountPaise'),
    counterparty: text(t['counterparty'], 'transaction.counterparty'),
    memo: text(t['memo'], 'transaction.memo'),
    category: nullable(t['category'], (v) => text(v, 'transaction.category')),
    kind: oneOf(t['kind'], TX_KINDS, 'transaction.kind'),
    method: oneOf(t['method'], PAYMENT_METHODS, 'transaction.method'),
    status: oneOf(t['status'], TX_STATUSES, 'transaction.status'),
    source: oneOf(t['source'], TX_SOURCES, 'transaction.source'),
  };
}

export const decodeTransactions = (value: unknown): TransactionView[] =>
  list(record(value, 'transactions')['items'], 'transactions.items').map(decodeTransaction);

export function decodeSummary(value: unknown): SummaryView {
  const r = record(value, 'summary');
  const byKind = record(r['byKind'], 'summary.byKind');
  return {
    month: text(r['month'], 'summary.month'),
    incomePaise: money(r['incomePaise'], 'summary.incomePaise'),
    spendPaise: money(r['spendPaise'], 'summary.spendPaise'),
    investedPaise: money(r['investedPaise'], 'summary.investedPaise'),
    familyPaise: money(r['familyPaise'], 'summary.familyPaise'),
    fixedSpendPaise: money(r['fixedSpendPaise'], 'summary.fixedSpendPaise'),
    variableSpendPaise: money(r['variableSpendPaise'], 'summary.variableSpendPaise'),
    leftoverPaise: money(r['leftoverPaise'], 'summary.leftoverPaise'),
    transferCount: int(
      record(byKind['transfer'], 'summary.byKind.transfer')['count'],
      'summary.byKind.transfer.count',
    ),
    spendByCategory: list(r['spendByCategory'], 'summary.spendByCategory').map((item) => {
      const c = record(item, 'summary.spendByCategory[]');
      return {
        category: text(c['category'], 'category.category'),
        spentPaise: money(c['spentPaise'], 'category.spentPaise'),
        fixed: flag(c['fixed'], 'category.fixed'),
      };
    }),
  };
}

export interface ImportRowView {
  /** Identifies this statement row across previews; used to send a choice back. */
  readonly rowKey: string;
  /** 1-based line in the uploaded file. */
  readonly line: number;
  readonly date: LocalDate;
  readonly amountPaise: Paise;
  readonly counterparty: string;
}

export interface ImportMergeView extends ImportRowView {
  /** The entry you added by hand that this statement row completes. */
  readonly pendingId: string;
}

export interface ImportAmbiguousView extends ImportRowView {
  /** Entries that could each be this payment. The user decides; nothing is guessed. */
  readonly pendingIds: readonly string[];
}

export interface ImportIssueView {
  /** 0 when the problem is the whole file. */
  readonly line: number;
  readonly reason: string;
}

export interface ImportPlanView {
  readonly duplicateCount: number;
  readonly toInsert: readonly ImportRowView[];
  readonly merges: readonly ImportMergeView[];
  readonly ambiguous: readonly ImportAmbiguousView[];
  readonly issues: readonly ImportIssueView[];
}

export interface ImportOutcomeView {
  /** Null when nothing changed, so no batch was created. */
  readonly batchId: string | null;
  readonly inserted: number;
  readonly merged: number;
  readonly duplicates: number;
  readonly held: number;
}

function decodeImportRow(value: unknown, what: string): [ImportRowView, Record<string, unknown>] {
  const r = record(value, what);
  return [
    {
      rowKey: text(r['rowKey'], `${what}.rowKey`),
      line: int(r['line'], `${what}.line`),
      date: day(r['date'], `${what}.date`),
      amountPaise: money(r['amountPaise'], `${what}.amountPaise`),
      counterparty: text(r['counterparty'], `${what}.counterparty`),
    },
    r,
  ];
}

export function decodeImportPlan(value: unknown): ImportPlanView {
  const r = record(value, 'import plan');
  return {
    duplicateCount: int(r['duplicateCount'], 'import.duplicateCount'),
    toInsert: list(r['toInsert'], 'import.toInsert').map((item) => decodeImportRow(item, 'row')[0]),
    merges: list(r['merges'], 'import.merges').map((item) => {
      const [row, raw] = decodeImportRow(item, 'merge');
      return { ...row, pendingId: text(raw['pendingId'], 'merge.pendingId') };
    }),
    ambiguous: list(r['ambiguous'], 'import.ambiguous').map((item) => {
      const [row, raw] = decodeImportRow(item, 'ambiguous row');
      return {
        ...row,
        pendingIds: list(raw['pendingIds'], 'ambiguous.pendingIds').map((id) =>
          text(id, 'ambiguous.pendingIds[]'),
        ),
      };
    }),
    issues: list(r['issues'], 'import.issues').map((item) => {
      const i = record(item, 'import issue');
      return { line: int(i['line'], 'issue.line'), reason: text(i['reason'], 'issue.reason') };
    }),
  };
}

export function decodeImportOutcome(value: unknown): ImportOutcomeView {
  const r = record(value, 'import outcome');
  return {
    batchId: nullable(r['batchId'], (v) => text(v, 'outcome.batchId')),
    inserted: int(r['inserted'], 'outcome.inserted'),
    merged: int(r['merged'], 'outcome.merged'),
    duplicates: int(r['duplicates'], 'outcome.duplicates'),
    held: int(r['held'], 'outcome.held'),
  };
}

export const BUNDLE_STATUSES = ['settled', 'open'] as const;
export type BundleStatus = (typeof BUNDLE_STATUSES)[number];

/** Payments that cancel each other out (a purchase and its refund), counted once at their net. */
export interface BundleView {
  readonly id: string;
  readonly txIds: readonly string[];
  /** What the group really cost (negative) or gained (positive) in total. */
  readonly netPaise: Paise;
  /** `settled`: same name on both sides. `open`: the names differ, so it is only a suggestion. */
  readonly status: BundleStatus;
}

export const UNMATCHED_REASONS = ['ambiguous', 'group-too-large'] as const;
export type UnmatchedReason = (typeof UNMATCHED_REASONS)[number];

/** A payment that looks like it matches something, but not clearly enough to pair up. */
export interface UnmatchedView {
  readonly txId: string;
  readonly reason: UnmatchedReason;
  readonly relatedTxIds: readonly string[];
}

export interface ReconcileTxView {
  readonly id: string;
  readonly accountId: string;
  readonly date: LocalDate;
  readonly amountPaise: Paise;
  readonly counterparty: string;
}

export interface ReconcileView {
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly bundles: readonly BundleView[];
  readonly unmatched: readonly UnmatchedView[];
  /** Ordinary payments with nothing to match against. */
  readonly singleCount: number;
  /** Every payment a bundle or review item refers to. A Map, so an odd id can never hit a prototype. */
  readonly transactions: ReadonlyMap<string, ReconcileTxView>;
}

function decodeReconcileTx(value: unknown): ReconcileTxView {
  const t = record(value, 'reconcile transaction');
  return {
    id: text(t['id'], 'reconcile.tx.id'),
    accountId: text(t['accountId'], 'reconcile.tx.accountId'),
    date: day(t['date'], 'reconcile.tx.date'),
    amountPaise: money(t['amountPaise'], 'reconcile.tx.amountPaise'),
    counterparty: text(t['counterparty'], 'reconcile.tx.counterparty'),
  };
}

export function decodeReconcile(value: unknown): ReconcileView {
  const r = record(value, 'reconcile');
  const transactions = new Map<string, ReconcileTxView>();
  for (const [key, tx] of Object.entries(record(r['transactions'], 'reconcile.transactions'))) {
    transactions.set(key, decodeReconcileTx(tx));
  }
  return {
    from: day(r['from'], 'reconcile.from'),
    to: day(r['to'], 'reconcile.to'),
    bundles: list(r['bundles'], 'reconcile.bundles').map((item) => {
      const b = record(item, 'bundle');
      return {
        id: text(b['id'], 'bundle.id'),
        txIds: list(b['txIds'], 'bundle.txIds').map((id) => text(id, 'bundle.txIds[]')),
        netPaise: money(b['netPaise'], 'bundle.netPaise'),
        status: oneOf(b['status'], BUNDLE_STATUSES, 'bundle.status'),
      };
    }),
    unmatched: list(r['unmatched'], 'reconcile.unmatched').map((item) => {
      const u = record(item, 'unmatched');
      return {
        txId: text(u['txId'], 'unmatched.txId'),
        reason: oneOf(u['reason'], UNMATCHED_REASONS, 'unmatched.reason'),
        relatedTxIds: list(u['relatedTxIds'], 'unmatched.relatedTxIds').map((id) =>
          text(id, 'unmatched.relatedTxIds[]'),
        ),
      };
    }),
    singleCount: int(r['singleCount'], 'reconcile.singleCount'),
    transactions,
  };
}
