import { describe, expect, it } from 'vitest';
import { MAX_PATTERN_LENGTH, categorise, compileRules } from './categorise.ts';
import type { CategoryRule } from './categorise.ts';

const rules: CategoryRule[] = [
  { id: 'r1', match: { kind: 'contains', value: 'swiggy' }, category: 'food' },
  { id: 'r2', match: { kind: 'startsWith', value: 'salary' }, category: 'salary', kind: 'income' },
  {
    id: 'r3',
    match: { kind: 'regex', value: '\\bCC\\s*PAYMENT\\b' },
    category: 'card bill',
    kind: 'transfer',
  },
  { id: 'r4', match: { kind: 'contains', value: 'lunch' }, field: 'memo', category: 'food' },
  { id: 'r5', match: { kind: 'contains', value: 'food' }, category: 'should never win over r1' },
];

const compiled = (): ReturnType<typeof compileRules>['compiled'] => {
  const result = compileRules(rules);
  expect(result.errors).toEqual([]);
  return result.compiled;
};

describe('categorise()', () => {
  it('first matching rule wins (rules are ordered)', () => {
    expect(categorise({ counterparty: 'UPI/SWIGGY FOOD/88', memo: '' }, compiled())).toEqual({
      ruleId: 'r1',
      category: 'food',
    });
  });

  it('contains/startsWith compare normalised text (case, punctuation, spacing)', () => {
    expect(categorise({ counterparty: '  Salary-ACME Corp ', memo: '' }, compiled())).toMatchObject(
      {
        ruleId: 'r2',
        kind: 'income',
      },
    );
  });

  it('regex rules are case-insensitive and can set kind', () => {
    expect(categorise({ counterparty: 'neft cc payment 4321', memo: '' }, compiled())).toEqual({
      ruleId: 'r3',
      category: 'card bill',
      kind: 'transfer',
    });
  });

  it('can match on memo instead of counterparty', () => {
    expect(categorise({ counterparty: 'UPI/123', memo: 'team lunch' }, compiled())?.ruleId).toBe(
      'r4',
    );
  });

  it('returns undefined when nothing matches', () => {
    expect(categorise({ counterparty: 'UNKNOWN SHOP', memo: '' }, compiled())).toBeUndefined();
  });
});

describe('compileRules()', () => {
  it('reports invalid, empty and oversized patterns instead of throwing', () => {
    const { compiled: ok, errors } = compileRules([
      { id: 'bad', match: { kind: 'regex', value: '(' }, category: 'x' },
      { id: 'empty', match: { kind: 'contains', value: '  ' }, category: 'x' },
      {
        id: 'long',
        match: { kind: 'regex', value: 'a'.repeat(MAX_PATTERN_LENGTH + 1) },
        category: 'x',
      },
      { id: 'good', match: { kind: 'contains', value: 'ok' }, category: 'x' },
    ]);
    expect(errors.map((e) => e.ruleId)).toEqual(['bad', 'empty', 'long']);
    expect(ok.map((r) => r.rule.id)).toEqual(['good']);
  });
});
