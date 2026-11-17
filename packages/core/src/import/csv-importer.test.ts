import { describe, expect, it } from 'vitest';
import { createCsvImporter } from './csv-importer.ts';
import type { CsvMapping } from './types.ts';

const savings: CsvMapping = {
  id: 'fakebank-savings',
  label: 'FakeBank savings',
  dateColumn: 'Txn Date',
  dateFormat: 'dd/mm/yyyy',
  amount: { kind: 'debitCredit', debitColumn: 'Withdrawal', creditColumn: 'Deposit' },
  counterpartyColumn: 'Narration',
  refColumn: 'Ref No',
  footerMarkers: ['*** End', 'Opening Balance'],
};

const card: CsvMapping = {
  id: 'democard',
  label: 'DemoCard credit card',
  dateColumn: 'Date',
  dateFormat: 'dd-mmm-yy',
  amount: {
    kind: 'amountWithType',
    amountColumn: 'Amount',
    typeColumn: 'Type',
    debitMarkers: ['Dr'],
    creditMarkers: ['Cr'],
  },
  counterpartyColumn: 'Description',
};

const lines = (...rows: string[]): string => rows.join('\n');

describe('createCsvImporter()', () => {
  it('skips a preamble, finds the header, parses debit/credit rows and stops at the footer', () => {
    const csv = [
      '﻿FakeBank Ltd',
      'Account: XXXX1234,,,,',
      '',
      'Txn Date,Narration,Ref No,Withdrawal,Deposit,Balance',
      '01/11/2026,"UPI/CHAI POINT/123",R1,20.00,,"1,00,000.00"',
      '01/11/2026,SALARY ACME,,,"1,23,456.78","2,23,436.78"',
      '*** End of statement ***',
      'Opening Balance,1',
    ].join('\r\n');

    const result = createCsvImporter(savings).parse(csv);

    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([
      {
        line: 5,
        date: '2026-11-01',
        amount: -2000,
        counterparty: 'UPI/CHAI POINT/123',
        memo: '',
        ref: 'R1',
      },
      { line: 6, date: '2026-11-01', amount: 12_345_678, counterparty: 'SALARY ACME', memo: '' },
    ]);
  });

  it('parses an amount + Dr/Cr card statement', () => {
    const csv = lines(
      'Date,Description,Amount,Type',
      '05-Nov-26,SHOP ONE,"7,246.00",Dr',
      '07-Nov-26,REFUND SHOP ONE,7197,Cr',
    );
    const { rows, issues } = createCsvImporter(card).parse(csv);
    expect(issues).toEqual([]);
    expect(rows.map((r) => [r.date, r.amount])).toEqual([
      ['2026-11-05', -724_600],
      ['2026-11-07', 719_700],
    ]);
  });

  it('parses a signed single-column statement', () => {
    const signed: CsvMapping = {
      ...card,
      amount: { kind: 'signed', column: 'Amount' },
      dateFormat: 'yyyy-mm-dd',
    };
    const csv = lines(
      'Date,Description,Amount',
      '2026-11-05,A,-20',
      '2026-11-06,B,(5)',
      '2026-11-07,C,30',
    );
    expect(
      createCsvImporter(signed)
        .parse(csv)
        .rows.map((r) => r.amount),
    ).toEqual([-2000, -500, 3000]);
  });

  it('reports bad rows as issues instead of dropping or guessing', () => {
    const csv = lines(
      'Txn Date,Narration,Ref No,Withdrawal,Deposit',
      '31/02/2026,BAD DATE,,10,',
      '01/11/2026,BOTH SIDES,,10,10',
      '01/11/2026,NEITHER,,,',
      '01/11/2026,BAD AMOUNT,,1.234,',
      '01/11/2026,SHORT ROW',
      '02/11/2026,GOOD,,5,',
    );
    const { rows, issues } = createCsvImporter(savings).parse(csv);
    expect(rows.map((r) => r.counterparty)).toEqual(['GOOD']);
    expect(issues.map((i) => i.line)).toEqual([2, 3, 4, 5, 6]);
  });

  it('treats a zero on the other side of debit/credit as empty', () => {
    const csv = lines('Txn Date,Narration,Ref No,Withdrawal,Deposit', '01/11/2026,X,,0.00,50.00');
    expect(createCsvImporter(savings).parse(csv).rows[0]?.amount).toBe(5000);
  });

  it('rejects an unknown Dr/Cr marker', () => {
    const csv = lines('Date,Description,Amount,Type', '05-Nov-26,X,10,??');
    const { rows, issues } = createCsvImporter(card).parse(csv);
    expect(rows).toEqual([]);
    expect(issues).toHaveLength(1);
  });

  it('skips fully blank rows silently', () => {
    const csv = lines(
      'Txn Date,Narration,Ref No,Withdrawal,Deposit',
      '',
      ',,,,',
      '02/11/2026,GOOD,,5,',
    );
    const { rows, issues } = createCsvImporter(savings).parse(csv);
    expect(rows).toHaveLength(1);
    expect(issues).toEqual([]);
  });

  it('reports a missing header', () => {
    const { rows, issues } = createCsvImporter(savings).parse(lines('Foo,Bar', '1,2'));
    expect(rows).toEqual([]);
    expect(issues[0]?.reason).toMatch(/header/i);
  });

  it('reports malformed CSV as an issue', () => {
    const { issues } = createCsvImporter(savings).parse(lines('Txn Date,Narration', '"oops'));
    expect(issues[0]?.reason).toMatch(/quote/i);
  });

  it('trims cells and joins extra memo columns', () => {
    const withMemo: CsvMapping = { ...savings, memoColumns: ['Remarks'] };
    const csv = lines(
      'Txn Date,Narration,Ref No,Withdrawal,Deposit,Remarks',
      '01/11/2026,  SHOP  ,,5,, lunch ',
    );
    expect(createCsvImporter(withMemo).parse(csv).rows[0]).toMatchObject({
      counterparty: 'SHOP',
      memo: 'lunch',
    });
  });
});
