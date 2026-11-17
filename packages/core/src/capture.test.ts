import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCapture } from './capture.ts';
import { localDate } from './dates.ts';
import { paise } from './money.ts';

const ctx = { today: localDate(2026, 11, 17) };

describe('parseCapture(): the quick-add grammar', () => {
  it('parses "20 food upi" into a pending manual spend', () => {
    expect(parseCapture('20 food upi', ctx)).toEqual({
      ok: true,
      entry: {
        date: localDate(2026, 11, 17),
        amount: paise(-2000),
        method: 'upi',
        category: 'food',
        memo: '',
        kind: 'spend',
        source: 'manual',
        status: 'pending',
      },
    });
  });

  it('takes the rest as a memo and ignores filler words', () => {
    const result = parseCapture('spent ₹450 on dinner at Jacob card', ctx);
    expect(result).toMatchObject({
      ok: true,
      entry: { amount: -45_000, method: 'card', category: 'dinner', memo: 'Jacob' },
    });
  });

  it('accepts Indian grouping, decimals and the method anywhere', () => {
    expect(parseCapture('1,200.50 cash fuel', ctx)).toMatchObject({
      ok: true,
      entry: { amount: -120_050, method: 'cash', category: 'fuel' },
    });
  });

  it('treats +amount or "got/received" as income', () => {
    for (const text of ['+500 gift upi', 'got 500 gift upi', 'received 500 gift upi']) {
      expect(parseCapture(text, ctx)).toMatchObject({
        ok: true,
        entry: { amount: 50_000, kind: 'income', category: 'gift' },
      });
    }
  });

  it('understands today, yesterday and an ISO date', () => {
    expect(parseCapture('20 chai yesterday', ctx)).toMatchObject({
      entry: { date: localDate(2026, 11, 16) },
    });
    expect(parseCapture('20 chai 2026-11-01 upi', ctx)).toMatchObject({
      entry: { date: localDate(2026, 11, 1) },
    });
    expect(parseCapture('20 chai today', ctx)).toMatchObject({
      entry: { date: localDate(2026, 11, 17) },
    });
  });

  it('uses the default method (UPI unless configured) when none is given', () => {
    expect(parseCapture('20 food', ctx)).toMatchObject({ entry: { method: 'upi' } });
    expect(parseCapture('20 food', { ...ctx, defaultMethod: 'cash' })).toMatchObject({
      entry: { method: 'cash' },
    });
  });

  it('maps method aliases (cc, nb)', () => {
    expect(parseCapture('20 food cc', ctx)).toMatchObject({ entry: { method: 'card' } });
    expect(parseCapture('20 food nb', ctx)).toMatchObject({ entry: { method: 'netbanking' } });
  });

  it.each([
    ['', 'Empty'],
    ['food upi', 'amount'],
    ['0 food upi', 'zero'],
    ['20', 'category'],
    ['20 upi', 'category'],
    ['20 food upi card', 'payment method'],
    ['20 food 2026-02-30', 'date'],
    ['20 2 chai', 'category'],
    ['20 fo/od', 'category'],
    ['20 food yesterday today', 'date'],
    ['1e3 food', 'amount'],
    ['20 food ' + 'x'.repeat(300), 'too long'],
  ])('rejects %j with a clear reason', (text, reason) => {
    const result = parseCapture(text, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain(reason.toLowerCase());
  });

  it('strips control characters from the memo and caps its length', () => {
    const result = parseCapture(`20 food upi ${'a\u0007b '.repeat(40)}`, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (let i = 0; i < result.entry.memo.length; i += 1) {
        const code = result.entry.memo.charCodeAt(i);
        expect(code >= 32 && code !== 127).toBe(true);
      }
      expect(result.entry.memo.length).toBeLessThanOrEqual(80);
    }
  });

  it('never throws, whatever the input (untrusted text)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (text) => {
        const result = parseCapture(text, ctx);
        expect(typeof result.ok).toBe('boolean');
      }),
    );
  });

  it('round-trips: any valid amount and category parse back exactly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99_999_999 }),
        fc.stringMatching(/^[a-z][a-z0-9_-]{0,31}$/),
        (amountPaise, category) => {
          const rupees = Math.floor(amountPaise / 100);
          const frac = String(amountPaise % 100).padStart(2, '0');
          const filler = new Set(['on', 'for', 'at', 'to', 'from', 'in']);
          const keywords = new Set([
            'spent',
            'paid',
            'got',
            'received',
            'today',
            'yesterday',
            'upi',
            'card',
            'cc',
            'cash',
            'netbanking',
            'nb',
          ]);
          fc.pre(!filler.has(category) && !keywords.has(category));
          const result = parseCapture(`${String(rupees)}.${frac} ${category}`, ctx);
          expect(result).toMatchObject({ ok: true, entry: { amount: -amountPaise, category } });
        },
      ),
    );
  });
});
