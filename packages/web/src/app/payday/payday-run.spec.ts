import { TestBed } from '@angular/core/testing';
import { paise } from '@ledger/core';
import type { Paise } from '@ledger/core';
import type { PaydayOutcomeView, PaydaySplitView } from '../api/models';
import { PAYDAY_OUTCOME, PAYDAY_SPLIT, POTS } from '../../testing-api';
import { must, query } from '../../testing';
import { PaydayRun } from './payday-run';
import type { Preview } from './payday-store';

const preview = (split: PaydaySplitView = PAYDAY_SPLIT): Preview => ({
  amountPaise: paise(8_000_000),
  split,
  runId: 'run-1',
});

interface Options {
  hasRules?: boolean;
  preview?: Preview | null;
  applied?: PaydayOutcomeView | null;
  failure?: string;
  saving?: boolean;
}

async function render(options: Options = {}) {
  const fixture = TestBed.createComponent(PaydayRun);
  const set = (name: string, value: unknown) => {
    fixture.componentRef.setInput(name, value);
  };
  set('hasRules', options.hasRules ?? true);
  set('pots', POTS);
  set('preview', options.preview ?? null);
  set('applied', options.applied ?? null);
  if (options.failure !== undefined) set('failure', options.failure);
  if (options.saving !== undefined) set('saving', options.saving);
  const events: string[] = [];
  const amounts: Paise[] = [];
  const component = fixture.componentInstance;
  component.calculate.subscribe((amount) => {
    events.push('calculate');
    amounts.push(amount);
  });
  component.apply.subscribe(() => events.push('apply'));
  component.discard.subscribe(() => events.push('discard'));
  component.dismiss.subscribe(() => events.push('dismiss'));
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const press = async (label: string) => {
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
    must(button, `a button "${label}"`).click();
    await fixture.whenStable();
  };
  const type = async (value: string) => {
    const input = query(el, '#run-amount') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const send = async () => {
    query(el, 'form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  return { fixture, el, events, amounts, press, type, send };
}

describe('PaydayRun', () => {
  describe('asking for a split', () => {
    it('sends the salary as exact paise', async () => {
      const { type, send, amounts } = await render();
      await type('85,000.50');
      await send();
      expect(amounts).toEqual([8_500_050]);
    });

    it.each([
      ['', 'Use a plain amount'],
      ['lots', 'Use a plain amount'],
      ['0', 'Enter more than zero.'],
      ['-100', 'Enter more than zero.'],
    ])('refuses %j', async (value, message) => {
      const { type, send, events, el } = await render();
      await type(value);
      await send();
      expect(events).toEqual([]);
      expect(must(el.querySelector('#run-amount-err')).textContent).toContain(message);
    });

    it('cannot be used until a split is saved', async () => {
      const { el } = await render({ hasRules: false });
      const button = query(el, 'button[type="submit"]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(el.textContent).toContain('Save your split above first');
    });

    it('says that looking changes nothing when there is a split', async () => {
      const { el } = await render();
      expect(el.textContent).toContain('Looking at the split changes nothing.');
    });
  });

  describe('the split on screen', () => {
    it('lists each line with where it goes and what it gets', async () => {
      const { el } = await render({ preview: preview() });
      const rows = [...el.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
      );
      expect(rows).toEqual([
        ['Emergency buffer', 'Emergency buffer', '₹5,000.00'],
        ['Investing', 'Stays with you', '₹16,000.00'],
        ['Spending', 'Stays with you', '₹59,000.00'],
      ]);
      expect(must(el.querySelector('caption')).textContent).toContain('₹80,000.00');
    });

    it('shows a shortfall and money no line claimed', async () => {
      const split: PaydaySplitView = {
        allocations: [
          {
            name: 'Rent',
            potId: 'pot-rent',
            kind: 'fixed',
            requestedPaise: paise(9_000_000),
            allocatedPaise: paise(8_000_000),
            shortfallPaise: paise(1_000_000),
          },
        ],
        unallocatedPaise: paise(500),
      };
      const { el } = await render({ preview: preview(split) });
      expect(el.textContent).toContain('short by ₹10,000.00');
      expect(el.textContent).toContain('Not given to any line');
      expect(el.textContent).toContain('₹5.00');
    });

    it('can be closed', async () => {
      const { press, events } = await render({ preview: preview() });
      await press('Close');
      expect(events).toEqual(['discard']);
    });

    it('says when nothing goes into a pot and offers nothing to add', async () => {
      const split: PaydaySplitView = {
        allocations: [
          {
            name: 'Spending',
            potId: null,
            kind: 'remainder',
            requestedPaise: paise(8_000_000),
            allocatedPaise: paise(8_000_000),
            shortfallPaise: paise(0),
          },
        ],
        unallocatedPaise: paise(0),
      };
      const { el, press, events } = await render({ preview: preview(split) });
      expect(el.textContent).toContain('nothing to add');
      expect(
        [...el.querySelectorAll('button')].some((b) => b.textContent.includes('Add to pots')),
      ).toBe(false);
      await press('Close');
      expect(events).toEqual(['discard']);
    });
  });

  describe('adding it to the pots', () => {
    it('asks first, naming the total and the number of pots', async () => {
      const { el, press, events } = await render({ preview: preview() });
      await press('Add to pots');
      expect(events).toEqual([]);
      const ask = must(el.querySelector('.confirm')).textContent.replace(/\s+/g, ' ');
      expect(ask).toContain('Add ₹5,000.00 to 1 pot?');
      expect(ask).toContain('fixed with another entry');
    });

    it('adds only after "Yes, add it"', async () => {
      const { press, events } = await render({ preview: preview() });
      await press('Add to pots');
      await press('Yes, add it');
      expect(events).toEqual(['apply']);
    });

    it('goes back without adding', async () => {
      const { el, press, events } = await render({ preview: preview() });
      await press('Add to pots');
      await press('Back');
      expect(events).toEqual([]);
      expect(el.querySelector('.confirm')).toBeNull();
    });

    it('asks again for a new split rather than carrying the answer over', async () => {
      const { fixture, el, press } = await render({ preview: preview() });
      await press('Add to pots');
      fixture.componentRef.setInput('preview', { ...preview(), runId: 'run-2' });
      await fixture.whenStable();
      expect(el.querySelector('.confirm')).toBeNull();
    });

    it('shows why it failed and keeps the question open for a retry', async () => {
      const { el, press } = await render({
        preview: preview(),
        failure: 'Could not reach the server',
      });
      await press('Add to pots');
      expect(must(el.querySelector('[role="alert"]')).textContent).toContain('Could not reach');
      expect(el.querySelector('.confirm')).not.toBeNull();
    });

    it('disables both buttons while adding', async () => {
      const { el, press } = await render({ preview: preview(), saving: true });
      await press('Add to pots');
      const buttons = [...el.querySelectorAll('button')].filter((b) =>
        ['Adding…', 'Back'].includes(b.textContent.trim()),
      );
      expect(buttons).toHaveLength(2);
      expect(buttons.every((b) => b.disabled)).toBe(true);
    });
  });

  describe('after adding', () => {
    it('lists what went into which pot and can be dismissed', async () => {
      const { el, press, events } = await render({ applied: PAYDAY_OUTCOME });
      const done = must(el.querySelector('.done'));
      expect(done.getAttribute('role')).toBe('status');
      expect(done.textContent.replace(/\s+/g, ' ')).toContain('Added to 1 pot:');
      expect(done.textContent).toContain('Emergency buffer: ₹5,000.00');
      await press('Dismiss');
      expect(events).toEqual(['dismiss']);
    });

    it('says plainly when the same payday had already been added', async () => {
      const { el } = await render({ applied: { ...PAYDAY_OUTCOME, replayed: true } });
      expect(el.textContent).toContain('already added earlier. Nothing changed.');
    });

    it('shows a failure that happened before there was any split', async () => {
      const { el } = await render({ failure: 'Set payday rules first' });
      expect(must(el.querySelector('[role="alert"]')).textContent).toContain('Set payday rules');
    });
  });
});
