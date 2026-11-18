import { TestBed } from '@angular/core/testing';
import type { ScheduledInput } from '../api/api-client';
import { must, query } from '../../testing';
import { ScheduledForm } from './scheduled-form';

async function render(over: { failure?: string; saving?: boolean } = {}) {
  const fixture = TestBed.createComponent(ScheduledForm);
  if (over.failure !== undefined) fixture.componentRef.setInput('failure', over.failure);
  if (over.saving !== undefined) fixture.componentRef.setInput('saving', over.saving);
  const added: ScheduledInput[] = [];
  const events: string[] = [];
  fixture.componentInstance.add.subscribe((input) => added.push(input));
  fixture.componentInstance.cancel.subscribe(() => events.push('cancel'));
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const type = async (selector: string, value: string) => {
    const input = query(el, selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const repeat = async (value: string) => {
    const select = query(el, '#sch-repeat') as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  const send = async () => {
    query(el, 'form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  return { el, added, events, type, repeat, send };
}

describe('ScheduledForm', () => {
  it('adds an item that repeats on a day of the month', async () => {
    const { type, send, added } = await render();
    await type('#sch-name', '  Rent ');
    await type('#sch-amount', '25,000');
    await type('#sch-day', '1');
    await send();
    expect(added).toEqual([{ name: 'Rent', amountPaise: 2_500_000, monthlyDay: 1 }]);
  });

  it('adds a one-off item on a date', async () => {
    const { type, repeat, send, added, el } = await render();
    await repeat('once');
    expect(el.querySelector('#sch-day')).toBeNull();
    await type('#sch-name', 'Insurance');
    await type('#sch-amount', '11000.50');
    await type('#sch-date', '2026-11-28');
    await send();
    expect(added).toEqual([{ name: 'Insurance', amountPaise: 1_100_050, date: '2026-11-28' }]);
  });

  it('switches back to the monthly day', async () => {
    const { repeat, el } = await render();
    await repeat('once');
    await repeat('monthly');
    expect(el.querySelector('#sch-day')).not.toBeNull();
  });

  it('says what is wrong with each field and sends nothing', async () => {
    const { send, added, el } = await render();
    await send();
    expect(added).toEqual([]);
    expect(el.textContent).toContain('Give it a name.');
    expect(el.textContent).toContain('Use a plain amount like 2,500.');
    expect(el.textContent).toContain('Pick a day from 1 to 31.');
    expect(query(el, '#sch-name').getAttribute('aria-invalid')).toBe('true');
  });

  it.each(['0', '32', 'x', '1.5'])('refuses %j as a day', async (day) => {
    const { type, send, added, el } = await render();
    await type('#sch-name', 'Gym');
    await type('#sch-amount', '1000');
    await type('#sch-day', day);
    await send();
    expect(added).toEqual([]);
    expect(el.textContent).toContain('Pick a day from 1 to 31.');
  });

  it('refuses a zero amount, a long name and a missing date', async () => {
    const { type, repeat, send, added, el } = await render();
    await repeat('once');
    await type('#sch-name', 'x'.repeat(61));
    await type('#sch-amount', '0');
    await send();
    expect(added).toEqual([]);
    expect(el.textContent).toContain('Keep the name to 60 characters.');
    expect(el.textContent).toContain('Enter more than zero.');
    expect(el.textContent).toContain('Pick a real date.');
  });

  it('can be cancelled', async () => {
    const { el, events } = await render();
    const cancel = [...el.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Cancel',
    );
    must(cancel).click();
    expect(events).toEqual(['cancel']);
  });

  it('shows why a save failed and disables the button while saving', async () => {
    const failed = await render({ failure: 'Changing this needs a full-access token.' });
    expect(must(failed.el.querySelector('[role="alert"]')).textContent).toContain('full-access');
    TestBed.resetTestingModule();
    const busy = await render({ saving: true });
    const submit = query(busy.el, 'button[type="submit"]') as HTMLButtonElement;
    expect(submit.textContent.trim()).toBe('Saving…');
    expect(submit.disabled).toBe(true);
  });
});
