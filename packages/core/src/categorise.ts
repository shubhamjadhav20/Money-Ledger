/**
 * Rule-based categoriser (no LLM). Rules are user-editable and ordered; the first match wins.
 * contains/startsWith compare normalised text, so bank formatting changes don't break rules.
 *
 * Regex rules come from the (single) user, so they are length-capped and compiled once.
 * TODO(M4): when rules are edited over the API, reject patterns with nested quantifiers too
 * (catastrophic backtracking), or switch regex rules to a linear-time engine.
 */
import type { TxKind } from './domain.ts';
import { normaliseCounterparty } from './import/identity.ts';

export const MAX_PATTERN_LENGTH = 200;

export interface CategoryRule {
  readonly id: string;
  readonly match: { readonly kind: 'contains' | 'startsWith' | 'regex'; readonly value: string };
  /** Which text to test. Default: counterparty. */
  readonly field?: 'counterparty' | 'memo';
  readonly category: string;
  /** Optionally also classify the transaction, e.g. "CC PAYMENT" -> transfer. */
  readonly kind?: TxKind;
}

export interface CompiledRule {
  readonly rule: CategoryRule;
  readonly test: (text: string) => boolean;
}

export interface RuleError {
  readonly ruleId: string;
  readonly reason: string;
}

export interface Categorised {
  readonly ruleId: string;
  readonly category: string;
  readonly kind?: TxKind;
}

function compileOne(rule: CategoryRule): CompiledRule | RuleError {
  const { kind, value } = rule.match;
  if (value.trim() === '') return { ruleId: rule.id, reason: 'Pattern is empty' };
  if (value.length > MAX_PATTERN_LENGTH) {
    return {
      ruleId: rule.id,
      reason: `Pattern longer than ${String(MAX_PATTERN_LENGTH)} characters`,
    };
  }
  if (kind === 'regex') {
    try {
      const re = new RegExp(value, 'iu');
      return { rule, test: (text) => re.test(text) };
    } catch (error) {
      return { ruleId: rule.id, reason: error instanceof Error ? error.message : 'Invalid regex' };
    }
  }
  const needle = normaliseCounterparty(value);
  if (needle === '') return { ruleId: rule.id, reason: 'Pattern has no letters or digits' };
  return kind === 'contains'
    ? { rule, test: (text) => normaliseCounterparty(text).includes(needle) }
    : { rule, test: (text) => normaliseCounterparty(text).startsWith(needle) };
}

export function compileRules(rules: readonly CategoryRule[]): {
  compiled: CompiledRule[];
  errors: RuleError[];
} {
  const compiled: CompiledRule[] = [];
  const errors: RuleError[] = [];
  for (const rule of rules) {
    const result = compileOne(rule);
    if ('test' in result) compiled.push(result);
    else errors.push(result);
  }
  return { compiled, errors };
}

export function categorise(
  tx: { readonly counterparty: string; readonly memo: string },
  rules: readonly CompiledRule[],
): Categorised | undefined {
  for (const { rule, test } of rules) {
    const text = rule.field === 'memo' ? tx.memo : tx.counterparty;
    if (test(text)) {
      return {
        ruleId: rule.id,
        category: rule.category,
        ...(rule.kind === undefined ? {} : { kind: rule.kind }),
      };
    }
  }
  return undefined;
}
