import { TestBed } from '@angular/core/testing';
import type { SettingsChange } from '../api/api-client';
import { SETTINGS } from '../../testing-api';
import { must, query } from '../../testing';
import { SettingsForm } from './settings-form';

async function render(over: { failure?: string; saving?: boolean } = {}) {
  const fixture = TestBed.createComponent(SettingsForm);
  fixture.componentRef.setInput('settings', SETTINGS);
  if (over.failure !== undefined) fixture.componentRef.setInput('failure', over.failure);
  if (over.saving !== undefined) fixture.componentRef.setInput('saving', over.saving);
  const saved: SettingsChange[] = [];
  fixture.componentInstance.save.subscribe((change) => saved.push(change));
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const day = query(el, '#ps-day') as HTMLInputElement;
  const weekend = query(el, '#ps-weekend') as HTMLSelectElement;
  const exposure = query(el, '#ps-exposure') as HTMLSelectElement;
  const submit = query(el, 'button[type="submit"]') as HTMLButtonElement;
  const type = async (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const choose = async (select: HTMLSelectElement, value: string) => {
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  const send = async () => {
    query(el, 'form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  return { el, day, weekend, exposure, submit, saved, type, choose, send };
}

describe('SettingsForm', () => {
  it('shows the saved settings and nothing to save yet', async () => {
    const { day, weekend, exposure, submit, el } = await render();
    expect(day.value).toBe('7');
    expect(weekend.value).toBe('previous-weekday');
    expect(exposure.value).toBe('all_outstanding');
    expect(submit.disabled).toBe(true);
    expect(el.textContent).toContain('The careful choice');
  });

  it('sends only what changed', async () => {
    const { day, submit, saved, type, send } = await render();
    await type(day, '5');
    expect(submit.disabled).toBe(false);
    await send();
    expect(saved).toEqual([{ paydayDay: 5 }]);
  });

  it('sends the weekend rule and the card choice, and explains the new card choice', async () => {
    const { choose, weekend, exposure, send, saved, el } = await render();
    await choose(weekend, 'none');
    await choose(exposure, 'due_before_payday');
    expect(el.textContent).toContain('only the bills that fall due before your next payday');
    await send();
    expect(saved).toEqual([{ paydayWeekend: 'none', cardExposure: 'due_before_payday' }]);
  });

  it('turns back to "nothing to save" when a change is undone', async () => {
    const { day, submit, type } = await render();
    await type(day, '9');
    expect(submit.disabled).toBe(false);
    await type(day, '7');
    expect(submit.disabled).toBe(true);
  });

  it.each(['', '0', '32', 'abc', '1.5', '-3'])('refuses %j as a day', async (text) => {
    const { day, type, send, saved, el } = await render();
    await type(day, text);
    await send();
    expect(saved).toEqual([]);
    expect(must(el.querySelector('#ps-day-err')).textContent).toContain('1 to 31');
    expect(day.getAttribute('aria-invalid')).toBe('true');
  });

  it('ignores a select value it does not know', async () => {
    const { weekend, send, saved, el } = await render();
    weekend.insertAdjacentHTML('beforeend', '<option value="next-weekday">x</option>');
    weekend.value = 'next-weekday';
    weekend.dispatchEvent(new Event('change'));
    await send();
    expect(saved).toEqual([]);
    expect(el.querySelector('.problem')).toBeNull();
  });

  it('shows why a save failed and disables the button while saving', async () => {
    const failed = await render({ failure: 'Changing this needs a full-access token.' });
    expect(must(failed.el.querySelector('[role="alert"]')).textContent).toContain('full-access');
    TestBed.resetTestingModule();
    const busy = await render({ saving: true });
    expect(busy.submit.textContent.trim()).toBe('Saving…');
    expect(busy.submit.disabled).toBe(true);
  });
});
