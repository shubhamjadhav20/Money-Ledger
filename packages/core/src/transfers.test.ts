import { describe, expect, it } from 'vitest';
import { localDate } from './dates.ts';
import type { Account, LedgerTx } from './domain.ts';
import { paise } from './money.ts';
import { detectTransfers } from './transfers.ts';

const accounts: Account[] = [
  { id: 'bank', name: 'FakeBank', kind: 'bank' },
  { id: 'savings', name: 'FakeBank savings', kind: 'savings' },
  { id: 'card', name: 'DemoCard', kind: 'card' },
  { id: 'cash', name: 'Wallet', kind: 'cash' },
];

let seq = 0;
const tx = (accountId: string, day: number, rupees: number): LedgerTx => ({
  id: `t${String(++seq)}`,
  accountId,
  date: localDate(2026, 11, day),
  amount: paise(rupees * 100),
  counterparty: 'X',
  memo: '',
});

const detect = (txs: LedgerTx[], windowDays = 3): ReturnType<typeof detectTransfers> =>
  detectTransfers(txs, accounts, { windowDays });

describe('detectTransfers()', () => {
  it('pairs a card-bill payment: bank debit with card credit', () => {
    const debit = tx('bank', 5, -12_000);
    const credit = tx('card', 6, 12_000);
    expect(detect([debit, credit])).toEqual({
      pairs: [{ debitId: debit.id, creditId: credit.id }],
      ambiguous: [],
    });
  });

  it('pairs savings -> bank and bank -> cash (ATM) moves', () => {
    const a = tx('savings', 1, -5000);
    const b = tx('bank', 1, 5000);
    const c = tx('bank', 2, -2000);
    const d = tx('cash', 2, 2000);
    expect(detect([a, b, c, d]).pairs).toEqual([
      { debitId: a.id, creditId: b.id },
      { debitId: c.id, creditId: d.id },
    ]);
  });

  it('accepts a credit that posts before the debit, within the window', () => {
    const debit = tx('bank', 6, -100);
    const credit = tx('card', 5, 100);
    expect(detect([debit, credit]).pairs).toHaveLength(1);
  });

  it('never treats a card purchase plus a bank credit as a transfer (money cannot leave a card)', () => {
    expect(detect([tx('card', 5, -500), tx('bank', 5, 500)])).toEqual({ pairs: [], ambiguous: [] });
  });

  it('ignores same-account pairs, amount mismatches and pairs outside the window', () => {
    expect(detect([tx('bank', 5, -500), tx('bank', 5, 500)]).pairs).toEqual([]);
    expect(detect([tx('bank', 5, -500), tx('card', 5, 499)]).pairs).toEqual([]);
    expect(detect([tx('bank', 1, -500), tx('card', 5, 500)]).pairs).toEqual([]);
  });

  it('returns ambiguous candidates instead of guessing', () => {
    const debit = tx('bank', 5, -500);
    const c1 = tx('card', 5, 500);
    const c2 = tx('savings', 6, 500);
    expect(detect([debit, c1, c2])).toEqual({
      pairs: [],
      ambiguous: [{ debitId: debit.id, candidateCreditIds: [c1.id, c2.id] }],
    });
  });

  it('a credit wanted by two debits is ambiguous for both', () => {
    const d1 = tx('bank', 5, -500);
    const d2 = tx('savings', 5, -500);
    const credit = tx('card', 5, 500);
    const result = detect([d1, d2, credit]);
    expect(result.pairs).toEqual([]);
    expect(result.ambiguous.map((a) => a.debitId)).toEqual([d1.id, d2.id]);
  });

  it('rejects transactions on unknown accounts', () => {
    expect(() => detect([tx('nope', 1, -1), tx('bank', 1, 1)])).toThrow(/unknown account/i);
  });
});
