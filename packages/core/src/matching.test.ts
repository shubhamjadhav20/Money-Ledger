import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { localDate } from './dates.ts';
import { paise } from './money.ts';
import { DEFAULT_MATCH_OPTIONS, findPendingDuplicates, matchStatement } from './matching.ts';
import type { MatchOptions, PendingEntry, StatementRow } from './matching.ts';
import { planImport } from './import/identity.ts';

const pending = (id: string, day: number, rupees: number, over: Partial<PendingEntry> = {}) =>
  ({
    id,
    accountId: 'bank',
    method: 'upi',
    source: 'manual',
    date: localDate(2026, 11, day),
    amount: paise(Math.round(rupees * 100)),
    ...over,
  }) satisfies PendingEntry;

const row = (key: string, day: number, rupees: number): StatementRow => ({
  key,
  date: localDate(2026, 11, day),
  amount: paise(Math.round(rupees * 100)),
});

const opts = (over: Partial<MatchOptions> = {}): MatchOptions => ({
  ...DEFAULT_MATCH_OPTIONS,
  ...over,
});
const sorted = (ids: readonly string[]): string[] => [...ids].sort();

describe('matchStatement(): manual entry meets its statement row (PLAN rule 4b)', () => {
  it('merges a single match in place: one payment, one row', () => {
    const result = matchStatement('bank', [row('r1', 11, -20)], [pending('m1', 10, -20)]);
    expect(result.merges).toEqual([{ pendingId: 'm1', rowKey: 'r1' }]);
    expect(result.newRows).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(result.stillPending).toEqual([]);
  });

  it('inserts a statement row with no manual entry as a new transaction', () => {
    const result = matchStatement('bank', [row('r1', 11, -20)], []);
    expect(result.newRows).toEqual(['r1']);
    expect(result.merges).toEqual([]);
  });

  it('leaves an unmatched manual entry pending', () => {
    const result = matchStatement('bank', [], [pending('m1', 10, -20)]);
    expect(result.stillPending).toEqual(['m1']);
  });

  it('never guesses between two identical pending entries: reports ambiguity', () => {
    const result = matchStatement(
      'bank',
      [row('r1', 10, -20)],
      [pending('m1', 10, -20), pending('m2', 11, -20)],
    );
    expect(result.merges).toEqual([]);
    expect(result.newRows).toEqual([]); // held until the user picks: inserting would double-count
    expect(result.ambiguous).toEqual([{ rowKey: 'r1', pendingIds: ['m1', 'm2'] }]);
    expect(sorted(result.stillPending)).toEqual(['m1', 'm2']);
  });

  it('two statement rows that could each take either entry are all ambiguous', () => {
    const result = matchStatement(
      'bank',
      [row('r1', 10, -20), row('r2', 10, -20)],
      [pending('m1', 10, -20), pending('m2', 10, -20)],
    );
    expect(result.merges).toEqual([]);
    expect(result.ambiguous.map((a) => a.rowKey)).toEqual(['r1', 'r2']);
  });

  it('applies the user\'s choice for an ambiguous row, and "new" inserts it', () => {
    const rows = [row('r1', 10, -20)];
    const entries = [pending('m1', 10, -20), pending('m2', 11, -20)];
    const picked = matchStatement(
      'bank',
      rows,
      entries,
      opts({ choices: new Map([['r1', 'm2']]) }),
    );
    expect(picked.merges).toEqual([{ pendingId: 'm2', rowKey: 'r1' }]);
    expect(picked.stillPending).toEqual(['m1']);
    expect(picked.ambiguous).toEqual([]);

    const asNew = matchStatement(
      'bank',
      rows,
      entries,
      opts({ choices: new Map([['r1', 'new']]) }),
    );
    expect(asNew.newRows).toEqual(['r1']);
    expect(sorted(asNew.stillPending)).toEqual(['m1', 'm2']);
  });

  it('ignores a choice that is not a candidate, or reuses one entry twice', () => {
    const rows = [row('r1', 10, -20), row('r2', 10, -20)];
    const entries = [pending('m1', 10, -20), pending('m2', 10, -20)];
    const bogus = matchStatement(
      'bank',
      rows,
      entries,
      opts({ choices: new Map([['r1', 'zzz']]) }),
    );
    expect(bogus.merges).toEqual([]);
    expect(bogus.ambiguous).toHaveLength(2);

    const twice = matchStatement(
      'bank',
      rows,
      entries,
      opts({
        choices: new Map([
          ['r1', 'm1'],
          ['r2', 'm1'],
        ]),
      }),
    );
    expect(twice.merges).toEqual([]);
    expect(twice.ambiguous).toHaveLength(2);
  });

  it('allows a fee within tolerance and rejects one beyond it', () => {
    const rows = [row('r1', 10, -1_005)];
    const entries = [pending('m1', 10, -1_000)];
    expect(matchStatement('bank', rows, entries).merges).toEqual([]); // strict by default
    const tolerant = opts({ tolerance: { absPaise: 1000, basisPoints: 0 } });
    expect(matchStatement('bank', rows, entries, tolerant).merges).toHaveLength(1);
    expect(matchStatement('bank', [row('r1', 10, -1_011)], entries, tolerant).merges).toEqual([]);
  });

  it('matches within ±2 days (either direction) but not a +3 day late posting', () => {
    const entries = [pending('m1', 10, -50)];
    expect(matchStatement('bank', [row('r', 12, -50)], entries).merges).toHaveLength(1);
    expect(matchStatement('bank', [row('r', 8, -50)], entries).merges).toHaveLength(1);
    expect(matchStatement('bank', [row('r', 13, -50)], entries).merges).toEqual([]);
    expect(
      matchStatement('bank', [row('r', 13, -50)], entries, opts({ windowDays: 3 })).merges,
    ).toHaveLength(1);
  });

  it('never matches cash, even when the amount and date are identical', () => {
    const result = matchStatement(
      'bank',
      [row('r1', 10, -20)],
      [pending('cash1', 10, -20, { method: 'cash' })],
      opts({ methods: new Set(['upi', 'cash']) }),
    );
    expect(result.merges).toEqual([]);
    expect(result.newRows).toEqual(['r1']);
    expect(result.stillPending).toEqual(['cash1']);
  });

  it('only matches entries whose method can appear on this statement, in this account', () => {
    const bankStatement = matchStatement(
      'bank',
      [row('r1', 10, -20)],
      [pending('card1', 10, -20, { method: 'card' })],
    );
    expect(bankStatement.merges).toEqual([]);

    const otherAccount = matchStatement(
      'bank',
      [row('r1', 10, -20)],
      [pending('x', 10, -20, { accountId: 'savings' })],
    );
    expect(otherAccount.merges).toEqual([]);
    expect(otherAccount.stillPending).toEqual([]); // not this import's business

    const cardStatement = matchStatement(
      'cc',
      [row('r1', 10, -20)],
      [pending('card1', 10, -20, { accountId: 'cc', method: 'card' })],
      opts({ methods: new Set(['card']) }),
    );
    expect(cardStatement.merges).toHaveLength(1);
  });

  it('never matches a debit with a credit of the same size', () => {
    const result = matchStatement('bank', [row('r1', 10, 20)], [pending('m1', 10, -20)]);
    expect(result.merges).toEqual([]);
  });

  it('is idempotent through the import pipeline: re-importing changes nothing', () => {
    const statement = [
      { ...row('x', 11, -20), counterparty: 'CHAI POINT' },
      { ...row('y', 11, -400), counterparty: 'GROCER' },
    ];
    let entries = [pending('m1', 10, -20)];
    const stored = new Set<string>();

    const run = () => {
      const plan = planImport('bank', statement, stored);
      const fresh = plan.fresh.map((k) => ({ ...k.row, key: k.identity }));
      const result = matchStatement('bank', fresh, entries);
      for (const k of plan.fresh) stored.add(k.identity);
      const merged = new Set(result.merges.map((m) => m.pendingId));
      entries = entries.filter((e) => !merged.has(e.id));
      return result;
    };

    const first = run();
    expect(first.merges).toHaveLength(1);
    expect(first.newRows).toHaveLength(1);
    const second = run();
    expect(second.merges).toEqual([]);
    expect(second.newRows).toEqual([]);
    expect(second.ambiguous).toEqual([]);
  });
});

describe('findPendingDuplicates(): SMS entry vs manual entry for the same payment', () => {
  it('merges one SMS entry into the manual one (manual survives)', () => {
    const result = findPendingDuplicates([
      pending('sms1', 10, -450, { source: 'sms' }),
      pending('m1', 10, -450),
    ]);
    expect(result.merges).toEqual([{ keepId: 'm1', dropId: 'sms1' }]);
    expect(result.ambiguous).toEqual([]);
  });

  it('does not merge two manual entries (two real chais) or two SMS entries', () => {
    expect(findPendingDuplicates([pending('a', 10, -20), pending('b', 10, -20)]).merges).toEqual(
      [],
    );
    expect(
      findPendingDuplicates([
        pending('a', 10, -20, { source: 'sms' }),
        pending('b', 10, -20, { source: 'sms' }),
      ]).merges,
    ).toEqual([]);
  });

  it('reports ambiguity when one SMS could be either of two manual entries', () => {
    const result = findPendingDuplicates([
      pending('s', 10, -20, { source: 'sms' }),
      pending('a', 10, -20),
      pending('b', 11, -20),
    ]);
    expect(result.merges).toEqual([]);
    expect(result.ambiguous.map((x) => sorted(x.ids))).toEqual([['a', 'b', 's']]);
  });

  it('ignores cash, other methods and different amounts', () => {
    expect(
      findPendingDuplicates([
        pending('s', 10, -20, { source: 'sms', method: 'cash' }),
        pending('m', 10, -20, { method: 'cash' }),
        pending('m2', 10, -21),
        pending('m3', 10, -20, { method: 'card' }),
      ]).merges,
    ).toEqual([]);
  });
});

describe('matchStatement(): exactly-once invariant (property)', () => {
  const arbitrary = fc.record({
    rows: fc.array(
      fc.record({
        day: fc.integer({ min: 1, max: 8 }),
        rupees: fc.constantFrom(-20, -20, -45, 100),
      }),
      { maxLength: 8 },
    ),
    entries: fc.array(
      fc.record({
        day: fc.integer({ min: 1, max: 8 }),
        rupees: fc.constantFrom(-20, -20, -45, 100),
        method: fc.constantFrom('upi', 'upi', 'cash'),
      }),
      { maxLength: 8 },
    ),
  });

  it('every row ends in exactly one bucket and no entry is merged twice', () => {
    fc.assert(
      fc.property(arbitrary, ({ rows, entries }) => {
        const statementRows = rows.map((r, i) => row(`r${String(i)}`, r.day, r.rupees));
        const pendings = entries.map((e, i) =>
          pending(`m${String(i)}`, e.day, e.rupees, { method: e.method }),
        );
        const result = matchStatement('bank', statementRows, pendings);

        const placed = [
          ...result.merges.map((m) => m.rowKey),
          ...result.newRows,
          ...result.ambiguous.map((a) => a.rowKey),
        ];
        expect(sorted(placed)).toEqual(sorted(statementRows.map((r) => r.key)));

        const mergedEntries = result.merges.map((m) => m.pendingId);
        expect(new Set(mergedEntries).size).toBe(mergedEntries.length);
        // A merged entry is gone from pending; the rest of this account's entries remain.
        expect(sorted([...mergedEntries, ...result.stillPending])).toEqual(
          sorted(pendings.map((p) => p.id)),
        );
        // Cash is never merged.
        const cash = new Set(pendings.filter((p) => p.method === 'cash').map((p) => p.id));
        expect(mergedEntries.some((id) => cash.has(id))).toBe(false);
      }),
    );
  });

  it('is deterministic: input order does not change the result', () => {
    fc.assert(
      fc.property(arbitrary, ({ rows, entries }) => {
        const statementRows = rows.map((r, i) => row(`r${String(i)}`, r.day, r.rupees));
        const pendings = entries.map((e, i) =>
          pending(`m${String(i)}`, e.day, e.rupees, { method: e.method }),
        );
        expect(
          matchStatement('bank', [...statementRows].reverse(), [...pendings].reverse()),
        ).toEqual(matchStatement('bank', statementRows, pendings));
      }),
    );
  });
});
