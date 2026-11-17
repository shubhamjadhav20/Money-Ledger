/**
 * CSV layouts for the two FAKE demo banks used by fixtures and the public demo.
 * Real bank layouts are added the same way (config only), never with real statements in git.
 */
import type { CsvMapping } from './types.ts';

/** Savings account: preamble, BOM, CRLF, dd/mm/yyyy, separate withdrawal/deposit columns, footer. */
export const FAKEBANK_SAVINGS: CsvMapping = {
  id: 'fakebank-savings',
  label: 'FakeBank savings (demo)',
  dateColumn: 'Txn Date',
  dateFormat: 'dd/mm/yyyy',
  amount: { kind: 'debitCredit', debitColumn: 'Withdrawal Amt', creditColumn: 'Deposit Amt' },
  counterpartyColumn: 'Narration',
  refColumn: 'Ref No',
  footerMarkers: ['*** End of Statement', 'Opening Balance'],
};

/** Credit card: dd-mmm-yy, unsigned amount with a Dr/Cr column. */
export const DEMOCARD: CsvMapping = {
  id: 'democard',
  label: 'DemoCard credit card (demo)',
  dateColumn: 'Date',
  dateFormat: 'dd-mmm-yy',
  amount: {
    kind: 'amountWithType',
    amountColumn: 'Amount (INR)',
    typeColumn: 'Dr/Cr',
    debitMarkers: ['Dr'],
    creditMarkers: ['Cr'],
  },
  counterpartyColumn: 'Transaction Details',
};

export const DEMO_MAPPINGS: readonly CsvMapping[] = [FAKEBANK_SAVINGS, DEMOCARD];
