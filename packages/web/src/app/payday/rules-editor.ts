import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { MoneyError, parseAmount, validatePaydayRules } from '@ledger/core';
import type { PaydayRule } from '@ledger/core';
import { RULE_KINDS } from '../api/models';
import type { PaydayRuleView, PotView, RuleKind } from '../api/models';
import { plainAmount } from '../format';
import { UiButton } from '../ui/button';
import { RULE_KIND_LABELS } from './labels';
import { parsePercent, plainPercent } from './percent';

/** One line being edited. Amounts and percentages stay as typed until Save. */
interface Row {
  readonly key: number;
  readonly kind: RuleKind;
  readonly name: string;
  readonly amount: string;
  readonly percent: string;
  /** '' means the money stays with you. */
  readonly potId: string;
}

type Field = 'name' | 'amount' | 'percent' | 'potId';

/**
 * The payday split: ordered lines that each take a fixed amount, a share of the salary, or what is
 * left, and may drop it into a pot. You edit a draft; nothing is saved until Save, and the same
 * checks the server runs (core's `validatePaydayRules`) show here first.
 */
@Component({
  selector: 'app-rules-editor',
  imports: [UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rules-editor.html',
  styleUrls: ['./fields.css', './rules-editor.css'],
})
export class RulesEditor {
  readonly rules = input.required<readonly PaydayRuleView[]>();
  readonly pots = input<readonly PotView[]>([]);
  readonly saving = input(false);
  readonly failure = input<string | null>(null);
  readonly save = output<readonly PaydayRule[]>();

  protected readonly kinds = RULE_KINDS;
  protected readonly kindLabels = RULE_KIND_LABELS;

  private seq = 0;

  /** The draft. It starts again from the saved rules whenever those change. */
  protected readonly rows = linkedSignal<readonly PaydayRuleView[], Row[]>({
    source: this.rules,
    computation: (rules) => rules.map((rule) => this.toRow(rule)),
  });
  protected readonly problems = signal<Readonly<Record<number, string>>>({});
  protected readonly general = signal<readonly string[]>([]);

  /** The shares typed so far, added up; empty when no share is readable. */
  protected readonly shareTotal = computed(() => {
    let total = 0;
    for (const row of this.rows()) {
      if (row.kind !== 'percent') continue;
      total += parsePercent(row.percent) ?? 0;
    }
    return total === 0 ? null : plainPercent(total);
  });

  private toRow(rule: PaydayRuleView): Row {
    return {
      key: this.seq++,
      kind: rule.kind,
      name: rule.name,
      amount: rule.kind === 'fixed' ? plainAmount(rule.amountPaise) : '',
      percent: rule.kind === 'percent' ? plainPercent(rule.basisPoints) : '',
      potId: rule.potId ?? '',
    };
  }

  private edit(index: number, change: Partial<Row>): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }

  protected text(index: number, field: Field, event: Event): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      this.edit(index, { [field]: event.target.value });
    }
  }

  protected kind(index: number, event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const value = event.target.value;
    const picked = RULE_KINDS.find((kind) => kind === value);
    if (picked !== undefined) this.edit(index, { kind: picked });
  }

  protected add(): void {
    this.rows.update((rows) => [
      ...rows,
      { key: this.seq++, kind: 'fixed', name: '', amount: '', percent: '', potId: '' },
    ]);
  }

  protected remove(index: number): void {
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
    this.problems.set({});
    this.general.set([]);
  }

  protected move(index: number, by: -1 | 1): void {
    this.rows.update((rows) => {
      const target = index + by;
      const moved = rows[index];
      const other = rows[target];
      if (moved === undefined || other === undefined) return rows;
      return rows.map((row, i) => (i === index ? other : i === target ? moved : row));
    });
  }

  protected revert(): void {
    this.rows.set(this.rules().map((rule) => this.toRow(rule)));
    this.problems.set({});
    this.general.set([]);
  }

  /** The rule a row means, or the reason it cannot be read. */
  private read(row: Row): PaydayRule | string {
    const name = row.name.trim();
    if (name === '') return 'Give this line a name.';
    if (name.length > 60) return 'Keep the name to 60 characters.';
    const base = { name, ...(row.potId === '' ? {} : { potId: row.potId }) };
    if (row.kind === 'remainder') return { ...base, kind: 'remainder' };
    if (row.kind === 'percent') {
      const basisPoints = parsePercent(row.percent);
      if (basisPoints === null) return 'Use a share like 20 or 12.5 (0 to 100).';
      return { ...base, kind: 'percent', basisPoints };
    }
    try {
      const amount = parseAmount(row.amount);
      if (amount < 0) return 'An amount cannot be negative.';
      return { ...base, kind: 'fixed', amountPaise: amount };
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error;
      return 'Use a plain amount like 5,000.';
    }
  }

  protected submit(): void {
    const problems: Record<number, string> = {};
    const rules: PaydayRule[] = [];
    for (const row of this.rows()) {
      const read = this.read(row);
      if (typeof read === 'string') problems[row.key] = read;
      else rules.push(read);
    }
    this.problems.set(problems);
    this.general.set([]);
    if (Object.keys(problems).length > 0) return;
    const rest = validatePaydayRules(rules);
    this.general.set(rest);
    if (rest.length === 0) this.save.emit(rules);
  }
}
