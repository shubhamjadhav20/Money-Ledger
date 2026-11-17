import type { MovementReason, PotView } from '../api/models';

export const POT_KIND_LABELS: Readonly<Record<PotView['kind'], string>> = {
  buffer: 'Safety buffer',
  bill: 'Bill',
  spend: 'Spending',
};

/** What each kind does to free-to-spend, in the words the Dashboard uses (core `free-to-spend`). */
export const POT_KIND_HELP: Readonly<Record<PotView['kind'], string>> = {
  buffer: 'Safety money. It is always kept out of free-to-spend.',
  bill: 'Money set aside for a bill. It is kept out of free-to-spend.',
  spend: 'Money for planned spending. It does not reduce free-to-spend.',
};

export const MOVEMENT_LABELS: Readonly<Record<MovementReason, string>> = {
  payday: 'Payday split',
  spend: 'Spent from the pot',
  trueup: 'Correction',
  manual: 'Moved by hand',
};
