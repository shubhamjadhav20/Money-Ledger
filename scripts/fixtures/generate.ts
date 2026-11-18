/**
 * Deterministic FAKE statement generator. Pure: returns file contents; the CLI writes them.
 * Every name and amount is invented. Same seed => byte-identical output.
 *
 * Built-in scenarios (asserted by fixtures.test.ts):
 * - two identical ₹20 chai rows on one day with no ref (must import as 2)
 * - card-bill payment: savings debit <-> card credit (a transfer, not spend)
 * - the PLAN.md golden reconcile case: 2 x +7,250, 2 x -7,246, -7,200, +7,197 => net +₹5
 */
import { formatINR, paise } from '../../packages/core/src/index.ts';
import type { Paise } from '../../packages/core/src/index.ts';

export const DEFAULT_SEED = 20261101;
const YEAR = 2026;
const MONTH = 10; // October 2026
const MONTH_NAME = 'Oct';
const BOM = String.fromCharCode(0xfeff);

/** mulberry32: tiny seeded PRNG, good enough for fake data. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MERCHANTS = [
  'GROCER ONE',
  'METRO RAIL',
  'BOOKSTORE TWO',
  'PHARMA PLUS',
  'CINEMA HALL',
  'FRUIT CART',
  'BAKERY THREE',
  'FUEL STATION',
] as const;

interface FakeTx {
  readonly day: number;
  readonly amount: Paise; // signed
  readonly details: string;
  readonly ref?: string;
}

/** "1,23,456.78" (Indian grouping, no symbol, no sign). */
const plain = (amount: Paise): string => formatINR(paise(Math.abs(amount))).replace('₹', '');

const csvField = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
const csvLine = (fields: readonly string[]): string => fields.map(csvField).join(',');

const dd = (day: number): string => String(day).padStart(2, '0');

function savingsTransactions(rand: () => number): FakeTx[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const amountBetween = (minRupees: number, maxRupees: number): number =>
    Math.round((minRupees + rand() * (maxRupees - minRupees)) * 100);
  let refSeq = 1000;
  const ref = (): string => `UPI${String(++refSeq)}`;

  const txs: FakeTx[] = [
    { day: 1, amount: paise(8_500_000), details: 'SALARY ACME CORP OCT' },
    { day: 2, amount: paise(-1_800_000), details: 'NEFT RENT TO LANDLORD (DEMO)', ref: 'NEFT0001' },
    // Two genuinely identical purchases: same day, same shop, same amount, no ref.
    { day: 3, amount: paise(-2000), details: 'UPI/CHAI POINT' },
    { day: 3, amount: paise(-2000), details: 'UPI/CHAI POINT' },
    // Card-bill payment (transfer): matches the DemoCard "PAYMENT RECEIVED" credit.
    { day: 10, amount: paise(-1_234_567), details: 'NEFT CC PAYMENT DEMOCARD', ref: 'NEFT0002' },
    // Golden reconcile scenario (fake people and shop).
    { day: 14, amount: paise(725_000), details: 'UPI/FRIEND ALPHA/TICKETS', ref: ref() },
    { day: 14, amount: paise(725_000), details: 'UPI/FRIEND BETA/TICKETS', ref: ref() },
    { day: 14, amount: paise(-724_600), details: 'UPI/EVENT TICKETS CO', ref: ref() },
    { day: 14, amount: paise(-724_600), details: 'UPI/EVENT TICKETS CO', ref: ref() },
    { day: 15, amount: paise(-720_000), details: 'UPI/FRIEND GAMMA/TICKETS', ref: ref() },
    { day: 17, amount: paise(719_700), details: 'UPI/EVENT TICKETS CO/REFUND', ref: ref() },
  ];

  for (let i = 0; i < 20; i++) {
    const merchant = pick(MERCHANTS);
    // A comma inside narration exercises CSV quoting.
    const details = i % 7 === 0 ? `UPI/${merchant}, BRANCH ${String(i)}` : `UPI/${merchant}`;
    txs.push({
      day: 1 + Math.floor(rand() * 28),
      amount: paise(-amountBetween(30, 2500)),
      details,
      ref: ref(),
    });
  }
  return txs.sort((a, b) => a.day - b.day);
}

function cardTransactions(rand: () => number): FakeTx[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const txs: FakeTx[] = [
    { day: 11, amount: paise(1_234_567), details: 'PAYMENT RECEIVED - THANK YOU' },
  ];
  for (let i = 0; i < 12; i++) {
    const rupees = 100 + Math.floor(rand() * 9000);
    txs.push({
      day: 1 + Math.floor(rand() * 28),
      amount: paise(-(rupees * 100 + Math.floor(rand() * 100))),
      details: `${pick(MERCHANTS)} ONLINE`,
    });
  }
  return txs.sort((a, b) => a.day - b.day);
}

/** One statement row exactly as printed: the CSV and the fake PDF are both drawn from these. */
export interface PrintedRow {
  readonly date: string;
  readonly narration: string;
  readonly ref: string;
  readonly withdrawal: string;
  readonly deposit: string;
  readonly balance: string;
}

const OPENING_BALANCE = 2_500_000; // ₹25,000.00

function printedRows(txs: readonly FakeTx[]): PrintedRow[] {
  let balance = OPENING_BALANCE;
  return txs.map((t) => {
    balance += t.amount;
    return {
      date: `${dd(t.day)}/${dd(MONTH)}/${String(YEAR)}`,
      narration: t.details,
      ref: t.ref ?? '',
      withdrawal: t.amount < 0 ? plain(t.amount) : '',
      deposit: t.amount > 0 ? plain(t.amount) : '',
      balance: plain(paise(balance)),
    };
  });
}

/** The fake savings statement as printed rows (the same data as the CSV fixture for this seed). */
export function fakeSavingsStatement(seed = DEFAULT_SEED): {
  readonly rows: PrintedRow[];
  readonly openingBalance: string;
} {
  return {
    rows: printedRows(savingsTransactions(prng(seed))),
    openingBalance: plain(paise(OPENING_BALANCE)),
  };
}

function savingsCsv(txs: readonly FakeTx[]): string {
  const lines = [
    'FakeBank Ltd (DEMO DATA - NOT A REAL BANK)',
    csvLine(['Account Holder: DEMO USER', '', '', '', '', '']),
    csvLine([
      `Statement Period: 01/${dd(MONTH)}/${String(YEAR)} to 31/${dd(MONTH)}/${String(YEAR)}`,
      '',
      '',
      '',
      '',
      '',
    ]),
    '',
    csvLine([
      'Txn Date',
      'Narration',
      'Ref No',
      'Withdrawal Amt',
      'Deposit Amt',
      'Closing Balance',
    ]),
  ];
  for (const r of printedRows(txs)) {
    lines.push(csvLine([r.date, r.narration, r.ref, r.withdrawal, r.deposit, r.balance]));
  }
  lines.push(
    '*** End of Statement ***',
    csvLine(['Opening Balance', plain(paise(OPENING_BALANCE))]),
  );
  // BOM + CRLF, like many bank exports.
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

function cardCsv(txs: readonly FakeTx[]): string {
  const lines = [csvLine(['Date', 'Transaction Details', 'Amount (INR)', 'Dr/Cr'])];
  for (const t of txs) {
    lines.push(
      csvLine([
        `${dd(t.day)}-${MONTH_NAME}-${String(YEAR % 100)}`,
        t.details,
        plain(t.amount),
        t.amount < 0 ? 'Dr' : 'Cr',
      ]),
    );
  }
  return `${lines.join('\n')}\n`;
}

export interface FixtureFile {
  readonly path: string; // relative to repo root
  readonly mappingId: string;
  readonly content: string;
}

export function generateFixtures(seed = DEFAULT_SEED): FixtureFile[] {
  const rand = prng(seed);
  return [
    {
      path: 'fixtures/fakebank-savings-2026-10.csv',
      mappingId: 'fakebank-savings',
      content: savingsCsv(savingsTransactions(rand)),
    },
    {
      path: 'fixtures/democard-2026-10.csv',
      mappingId: 'democard',
      content: cardCsv(cardTransactions(rand)),
    },
  ];
}
