/**
 * Monthly summary: where the money went. Pure and deterministic; the dashboard waterfall and the
 * `ledger://summary/{YYYY-MM}` MCP resource read from this.
 *
 * Every transaction is counted exactly once:
 * - a transaction in a reconciled bundle is not counted on its own; the bundle counts once, at its
 *   net, as spend, dated at its latest member (same rule as the forecast);
 * - everything else is counted under its kind.
 * Amounts are signed (negative = money out). Spend, invested and family are reported as positive
 * outflows; transfers are reported but never part of spend.
 */
import type { LocalDate } from './dates.ts';
import { TX_KINDS } from './domain.ts';
import type { TxKind } from './domain.ts';
import { paise } from './money.ts';
import type { Paise } from './money.ts';

export interface SummaryTx {
  readonly id: string;
  readonly date: LocalDate;
  readonly amount: Paise;
  readonly kind: TxKind;
  readonly category?: string;
}

export interface SummaryBundle {
  readonly txIds: readonly string[];
  readonly netPaise: Paise;
}

export interface SummaryOptions {
  readonly bundles?: readonly SummaryBundle[];
  /** Categories whose spend is "fixed" (subscriptions, recharge); the rest is "variable". */
  readonly fixedCategories?: ReadonlySet<string>;
  /** Transactions to leave out, e.g. pending entries suspected to duplicate a posted row. */
  readonly excludeIds?: ReadonlySet<string>;
}

export interface KindTotal {
  readonly netPaise: Paise;
  readonly count: number;
}

export interface CategoryTotal {
  readonly category: string;
  /** Positive = spent. */
  readonly spentPaise: Paise;
  readonly fixed: boolean;
}

export interface MonthlySummary {
  readonly month: string;
  readonly byKind: Record<TxKind, KindTotal>;
  readonly incomePaise: Paise;
  readonly investedPaise: Paise;
  readonly familyPaise: Paise;
  readonly spendPaise: Paise;
  readonly fixedSpendPaise: Paise;
  readonly variableSpendPaise: Paise;
  /** income - invested - family - spend */
  readonly leftoverPaise: Paise;
  readonly spendByCategory: CategoryTotal[];
}

export const UNCATEGORISED = 'Uncategorised';

/** paise() that never yields -0 (e.g. a spend that cancels out exactly). */
const clean = (n: number): Paise => paise(n === 0 ? 0 : n);

const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export function monthlySummary(
  month: string,
  txs: readonly SummaryTx[],
  options: SummaryOptions = {},
): MonthlySummary {
  if (!MONTH_PATTERN.test(month)) {
    throw new Error(`Invalid month ${JSON.stringify(month)}: expected YYYY-MM`);
  }
  const excluded = options.excludeIds ?? new Set<string>();
  const fixedCategories = options.fixedCategories ?? new Set<string>();
  const byId = new Map(txs.filter((t) => !excluded.has(t.id)).map((t) => [t.id, t]));

  const totals = new Map<TxKind, { net: number; count: number }>(
    TX_KINDS.map((k) => [k, { net: 0, count: 0 }]),
  );
  const spendByCategory = new Map<string, number>();
  const add = (kind: TxKind, amount: number, category: string | undefined): void => {
    const total = totals.get(kind);
    if (total === undefined) return;
    total.net += amount;
    total.count += 1;
    if (kind === 'spend') {
      const key = category ?? UNCATEGORISED;
      spendByCategory.set(key, (spendByCategory.get(key) ?? 0) - amount);
    }
  };

  const bundled = new Set<string>();
  for (const bundle of options.bundles ?? []) {
    const members = bundle.txIds.flatMap((id) => {
      const t = byId.get(id);
      return t === undefined ? [] : [t];
    });
    if (members.length === 0) continue;
    for (const m of members) bundled.add(m.id);
    const latest = members.reduce((a, b) => (b.date > a ? b.date : a), members[0]?.date ?? '');
    if (!latest.startsWith(month)) continue;
    const debits = members
      .filter((m) => m.amount < 0)
      .sort((a, b) => a.amount - b.amount || (a.id < b.id ? -1 : 1));
    add('spend', bundle.netPaise, debits[0]?.category);
  }

  for (const t of byId.values()) {
    if (bundled.has(t.id) || !t.date.startsWith(month)) continue;
    add(t.kind, t.amount, t.category);
  }

  const net = (k: TxKind): number => totals.get(k)?.net ?? 0;
  const byKind = Object.fromEntries(
    TX_KINDS.map((k) => [k, { netPaise: clean(net(k)), count: totals.get(k)?.count ?? 0 }]),
  ) as Record<TxKind, KindTotal>;

  const categories: CategoryTotal[] = [...spendByCategory]
    .map(([category, spent]) => ({
      category,
      spentPaise: clean(spent),
      fixed: fixedCategories.has(category),
    }))
    .sort((a, b) => b.spentPaise - a.spentPaise || (a.category < b.category ? -1 : 1));

  const spend = -net('spend');
  const fixedSpend = categories.filter((c) => c.fixed).reduce((s, c) => s + c.spentPaise, 0);
  return {
    month,
    byKind,
    incomePaise: clean(net('income')),
    investedPaise: clean(-net('investment')),
    familyPaise: clean(-net('family')),
    spendPaise: clean(spend),
    fixedSpendPaise: clean(fixedSpend),
    variableSpendPaise: clean(spend - fixedSpend),
    leftoverPaise: clean(net('income') + net('investment') + net('family') - spend),
    spendByCategory: categories,
  };
}
