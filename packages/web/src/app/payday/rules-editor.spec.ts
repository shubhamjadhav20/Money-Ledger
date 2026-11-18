import { TestBed } from '@angular/core/testing';
import type { PaydayRule } from '@ledger/core';
import type { PaydayRuleView } from '../api/models';
import { PAYDAY_RULES, POTS } from '../../testing-api';
import { must, query } from '../../testing';
import { RulesEditor } from './rules-editor';

interface Options {
  rules?: readonly PaydayRuleView[];
  failure?: string;
  saving?: boolean;
}

async function render(options: Options = {}) {
  const fixture = TestBed.createComponent(RulesEditor);
  fixture.componentRef.setInput('rules', options.rules ?? PAYDAY_RULES);
  fixture.componentRef.setInput('pots', POTS);
  if (options.failure !== undefined) fixture.componentRef.setInput('failure', options.failure);
  if (options.saving !== undefined) fixture.componentRef.setInput('saving', options.saving);
  const saved: (readonly PaydayRule[])[] = [];
  fixture.componentInstance.save.subscribe((rules) => saved.push(rules));
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const rows = () => [...el.querySelectorAll<HTMLElement>('li.row')];
  const field = (row: number, part: string) =>
    query(must(rows()[row]), `[id$="-${part}"]`) as HTMLInputElement & HTMLSelectElement;
  const type = async (control: HTMLInputElement, value: string) => {
    control.value = value;
    control.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const choose = async (control: HTMLSelectElement, value: string) => {
    control.value = value;
    control.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  const press = async (label: string | RegExp) => {
    const button = [...el.querySelectorAll('button')].find((b) =>
      typeof label === 'string'
        ? b.textContent.trim() === label
        : label.test(b.getAttribute('aria-label') ?? b.textContent),
    );
    must(button, `a button ${String(label)}`).click();
    await fixture.whenStable();
  };
  const send = async () => {
    query(el, 'form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  const names = () => rows().map((_, i) => field(i, 'name').value);
  return { el, rows, field, type, choose, press, send, saved, names };
}

describe('RulesEditor', () => {
  it('shows each saved line with what it takes and where it goes', async () => {
    const { rows, field, el } = await render();
    expect(rows()).toHaveLength(3);
    expect(field(0, 'name').value).toBe('Emergency buffer');
    expect(field(0, 'kind').value).toBe('fixed');
    expect(field(0, 'amount').value).toBe('5000');
    expect(field(0, 'pot').value).toBe('pot-buffer');
    expect(field(1, 'percent').value).toBe('20');
    expect(field(1, 'pot').value).toBe('');
    expect(rows()[2]?.querySelector('[id$="-amount"]')).toBeNull();
    expect(rows()[2]?.querySelector('[id$="-percent"]')).toBeNull();
    expect(el.textContent).toContain('Shares add up to 20% of the salary.');
  });

  it('saves the lines exactly as shown, as paise and basis points', async () => {
    const { send, saved } = await render();
    await send();
    expect(saved).toEqual([
      [
        { kind: 'fixed', name: 'Emergency buffer', amountPaise: 500_000, potId: 'pot-buffer' },
        { kind: 'percent', name: 'Investing', basisPoints: 2_000 },
        { kind: 'remainder', name: 'Spending' },
      ],
    ]);
  });

  it('edits a name, an amount and a pot', async () => {
    const { field, type, choose, send, saved } = await render();
    await type(field(0, 'name'), '  Safety net ');
    await type(field(0, 'amount'), '7,500.50');
    await choose(field(1, 'pot'), 'pot-rent');
    await send();
    expect(saved[0]?.[0]).toEqual({
      kind: 'fixed',
      name: 'Safety net',
      amountPaise: 750_050,
      potId: 'pot-buffer',
    });
    expect(saved[0]?.[1]).toEqual({
      kind: 'percent',
      name: 'Investing',
      basisPoints: 2_000,
      potId: 'pot-rent',
    });
  });

  it('changes what a line takes and swaps the input to match', async () => {
    const { rows, field, choose, type, send, saved } = await render();
    await choose(field(0, 'kind'), 'percent');
    expect(rows()[0]?.querySelector('[id$="-amount"]')).toBeNull();
    await type(field(0, 'percent'), '12.5');
    await send();
    expect(saved[0]?.[0]).toEqual({
      kind: 'percent',
      name: 'Emergency buffer',
      basisPoints: 1_250,
      potId: 'pot-buffer',
    });
  });

  it('adds a blank line that must be filled in before it can be saved', async () => {
    const { press, rows, send, saved, el } = await render();
    await press('Add a line');
    expect(rows()).toHaveLength(4);
    await send();
    expect(saved).toEqual([]);
    expect(el.textContent).toContain('Give this line a name.');
    expect(rows()[3]?.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('removes a line and moves lines up and down', async () => {
    const { press, names } = await render();
    await press(/Move Investing up/);
    expect(names()).toEqual(['Investing', 'Emergency buffer', 'Spending']);
    await press(/Move Spending up/);
    expect(names()).toEqual(['Investing', 'Spending', 'Emergency buffer']);
    await press(/Move Investing down/);
    expect(names()).toEqual(['Spending', 'Investing', 'Emergency buffer']);
    await press(/Remove Spending/);
    expect(names()).toEqual(['Investing', 'Emergency buffer']);
  });

  it('cannot move the first line up or the last line down', async () => {
    const { el } = await render();
    const buttons = [...el.querySelectorAll('button')];
    const first = buttons.find((b) => b.getAttribute('aria-label') === 'Move Emergency buffer up');
    const last = buttons.find((b) => b.getAttribute('aria-label') === 'Move Spending down');
    expect(must(first).disabled).toBe(true);
    expect(must(last).disabled).toBe(true);
  });

  it.each([
    ['', 'Use a plain amount'],
    ['abc', 'Use a plain amount'],
    ['-5', 'An amount cannot be negative'],
  ])('refuses %j as a fixed amount', async (value, message) => {
    const { field, type, send, saved, el } = await render();
    await type(field(0, 'amount'), value);
    await send();
    expect(saved).toEqual([]);
    expect(el.textContent).toContain(message);
  });

  it.each(['', 'lots', '101', '12.345'])('refuses %j as a share', async (value) => {
    const { field, type, send, saved, el } = await render();
    await type(field(1, 'percent'), value);
    await send();
    expect(saved).toEqual([]);
    expect(el.textContent).toContain('Use a share like 20 or 12.5');
  });

  it('refuses a name that is too long', async () => {
    const { field, type, send, saved, el } = await render();
    await type(field(0, 'name'), 'x'.repeat(61));
    await send();
    expect(saved).toEqual([]);
    expect(el.textContent).toContain('Keep the name to 60 characters.');
  });

  it('shows the same plain checks the server runs: shares over 100% and a misplaced remainder', async () => {
    const { field, type, choose, send, saved, el } = await render();
    await type(field(1, 'percent'), '95');
    await choose(field(0, 'kind'), 'percent');
    await type(field(0, 'percent'), '10');
    await send();
    expect(saved).toEqual([]);
    expect(el.textContent).toContain('Percent rules add up to more than 100%');

    await type(field(0, 'percent'), '5');
    await choose(field(0, 'kind'), 'remainder');
    await send();
    expect(saved).toEqual([]);
    expect(el.textContent).toContain('the remainder rule must be the last rule');
  });

  it('puts the draft back to the saved lines with Undo changes', async () => {
    const { field, type, press, names, el } = await render();
    await type(field(0, 'name'), 'Something else');
    await press(/Remove Investing/);
    await press('Undo changes');
    expect(names()).toEqual(['Emergency buffer', 'Investing', 'Spending']);
    expect(el.querySelector('.problem')).toBeNull();
  });

  it('starts the draft again when the saved rules change', async () => {
    const fixture = TestBed.createComponent(RulesEditor);
    fixture.componentRef.setInput('rules', PAYDAY_RULES);
    await fixture.whenStable();
    fixture.componentRef.setInput('rules', PAYDAY_RULES.slice(2));
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('li.row')).toHaveLength(1);
  });

  it('asks for a first line when there are none, and can save an empty split', async () => {
    const { el, send, saved } = await render({ rules: [] });
    expect(el.textContent).toContain('No split yet.');
    await send();
    expect(saved).toEqual([[]]);
  });

  it('shows why a save failed and disables the buttons while saving', async () => {
    const failed = await render({ failure: 'Changing this needs a full-access token.' });
    expect(must(failed.el.querySelector('[role="alert"]')).textContent).toContain('full-access');
    TestBed.resetTestingModule();
    const busy = await render({ saving: true });
    const submit = query(busy.el, 'button[type="submit"]') as HTMLButtonElement;
    expect(submit.textContent.trim()).toBe('Saving…');
    expect(submit.disabled).toBe(true);
  });
});
