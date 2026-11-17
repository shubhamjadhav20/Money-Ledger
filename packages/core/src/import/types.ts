import type { DateFormat, LocalDate } from '../dates.ts';
import type { Paise } from '../money.ts';

/** A statement row after parsing, before it becomes a Transaction. Amount is signed: negative = money out. */
export interface RawRow {
  readonly line: number;
  readonly date: LocalDate;
  readonly amount: Paise;
  readonly counterparty: string;
  readonly memo: string;
  readonly ref?: string;
}

export interface ParseIssue {
  /** 1-based line in the file; 0 when the problem is the whole file. */
  readonly line: number;
  readonly reason: string;
}

export interface ParseResult {
  readonly rows: RawRow[];
  readonly issues: ParseIssue[];
}

/** Anything that turns a statement file into rows: CSV now; PDF / AA sandbox later. */
export interface ImportSource {
  readonly id: string;
  parse(text: string): ParseResult;
}

export type AmountMapping =
  /** One signed column; negative means money out. */
  | { readonly kind: 'signed'; readonly column: string }
  /** Separate debit (out) and credit (in) columns; exactly one is filled per row. */
  | { readonly kind: 'debitCredit'; readonly debitColumn: string; readonly creditColumn: string }
  /** Unsigned amount plus a type column such as "Dr"/"Cr". */
  | {
      readonly kind: 'amountWithType';
      readonly amountColumn: string;
      readonly typeColumn: string;
      readonly debitMarkers: readonly string[];
      readonly creditMarkers: readonly string[];
    };

/** Per-bank CSV layout. Column names are matched case-insensitively after trimming. */
export interface CsvMapping {
  readonly id: string;
  readonly label: string;
  readonly delimiter?: string;
  readonly dateColumn: string;
  readonly dateFormat: DateFormat;
  readonly amount: AmountMapping;
  readonly counterpartyColumn: string;
  readonly refColumn?: string;
  /** Extra columns joined into the memo. */
  readonly memoColumns?: readonly string[];
  /** A row whose first cell starts with one of these ends the data (statement footers). */
  readonly footerMarkers?: readonly string[];
}
