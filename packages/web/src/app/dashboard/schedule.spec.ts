import { parseLocalDate, paise } from '@ledger/core';
import type { ScheduledView } from '../api/models';
import { occurrencesUntil } from './schedule';

const date = (text: string) => parseLocalDate(text, 'yyyy-mm-dd');

const item = (
  over: Partial<ScheduledView> & Pick<ScheduledView, 'id' | 'name'>,
): ScheduledView => ({
  amountPaise: paise(100),
  date: null,
  monthlyDay: null,
  ...over,
});

const today = date('2026-11-17');
const payday = date('2026-12-07');

describe('occurrencesUntil', () => {
  it('lists a one-off item only when it falls inside the window, ends included', () => {
    const found = occurrencesUntil(
      [
        item({ id: 'a', name: 'Today', date: today }),
        item({ id: 'b', name: 'Payday', date: payday }),
        item({ id: 'c', name: 'Past', date: date('2026-11-16') }),
        item({ id: 'd', name: 'Later', date: date('2026-12-08') }),
      ],
      today,
      payday,
    );
    expect(found.map((o) => o.name)).toEqual(['Today', 'Payday']);
  });

  it('lists a monthly item each time it lands in the window', () => {
    const found = occurrencesUntil(
      [
        item({ id: 'm', name: 'Rent', monthlyDay: 1 }),
        item({ id: 'n', name: 'Gym', monthlyDay: 25 }),
      ],
      today,
      payday,
    );
    expect(found.map((o) => `${o.name} ${o.date}`)).toEqual(['Gym 2026-11-25', 'Rent 2026-12-01']);
  });

  it('repeats a monthly item when the window spans several months', () => {
    const found = occurrencesUntil(
      [item({ id: 'm', name: 'Rent', monthlyDay: 1 })],
      date('2026-11-17'),
      date('2027-02-10'),
    );
    expect(found.map((o) => o.date)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01']);
  });

  it('clamps day 31 to the end of a short month', () => {
    const found = occurrencesUntil(
      [item({ id: 'm', name: 'Loan', monthlyDay: 31 })],
      date('2027-02-01'),
      date('2027-03-05'),
    );
    expect(found.map((o) => o.date)).toEqual(['2027-02-28']);
  });

  it('counts an item due today, and sorts by date then name', () => {
    const found = occurrencesUntil(
      [
        item({ id: 'z', name: 'Zed', date: date('2026-11-20') }),
        item({ id: 'a', name: 'Alpha', date: date('2026-11-20') }),
        item({ id: 'm', name: 'Today', monthlyDay: 17 }),
      ],
      today,
      payday,
    );
    expect(found.map((o) => o.name)).toEqual(['Today', 'Alpha', 'Zed']);
  });

  it('ignores an item with neither a date nor a monthly day', () => {
    expect(occurrencesUntil([item({ id: 'x', name: 'Empty' })], today, payday)).toEqual([]);
  });
});
