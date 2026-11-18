import type { CardExposure, PaydayWeekend, RuleKind } from '../api/models';

export const WEEKEND_LABELS: Readonly<Record<PaydayWeekend, string>> = {
  none: 'On the day, even on a weekend',
  'previous-weekday': 'The Friday before',
};

export const EXPOSURE_LABELS: Readonly<Record<CardExposure, string>> = {
  all_outstanding: 'Everything you owe on cards',
  due_before_payday: 'Only card bills due before payday',
};

export const EXPOSURE_HELP: Readonly<Record<CardExposure, string>> = {
  all_outstanding: 'The careful choice: free-to-spend keeps back every rupee your cards are owed.',
  due_before_payday:
    'Free-to-spend keeps back only the bills that fall due before your next payday.',
};

export const RULE_KIND_LABELS: Readonly<Record<RuleKind, string>> = {
  fixed: 'A fixed amount',
  percent: 'A share of the salary',
  remainder: 'Whatever is left',
};

/** 1 becomes "1st", 22 becomes "22nd", 11 becomes "11th". */
export function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${String(n)}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${String(n)}${suffix}`;
}
