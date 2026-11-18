import { TestBed } from '@angular/core/testing';
import { parseLocalDate, paise } from '@ledger/core';
import { ApiClient, ApiError } from '../api/api-client';
import { AuthStore } from '../api/auth';
import type { CapturedView } from '../api/models';
import { TODAY } from '../month';
import { fakeApi } from '../../testing-api';
import { must, query } from '../../testing';
import { QuickAdd } from './quick-add';

const text = (el: Element): string => el.textContent.replace(/\s+/g, ' ').trim();

async function render(over: Parameters<typeof fakeApi>[0] = {}, captureOnly = false) {
  const api = fakeApi(over);
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: TODAY, useValue: parseLocalDate('2026-11-17', 'yyyy-mm-dd') },
    ],
  });
  TestBed.inject(AuthStore).connect('tok', { captureOnly });
  const fixture = TestBed.createComponent(QuickAdd);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const type = async (selector: string, value: string): Promise<void> => {
    const input = query(root, selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const chip = (group: string, label: string): HTMLButtonElement =>
    must(
      [
        ...root.querySelectorAll<HTMLButtonElement>(
          `[aria-label="${group}"] button, [aria-labelledby="${group}"] button`,
        ),
      ].find((b) => text(b) === label),
      `chip ${label}`,
    );
  const submit = async (): Promise<void> => {
    query(root, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  return { api, root, settle, type, chip, submit };
}

const saved = (category: string, memo = ''): CapturedView => ({
  id: `id-${category}`,
  date: parseLocalDate('2026-11-17', 'yyyy-mm-dd'),
  amountPaise: paise(-45_000),
  method: 'upi',
  category,
  kind: 'spend',
  memo,
  status: 'pending',
});

describe('QuickAdd', () => {
  it('has one h1, a labelled amount field and the number keyboard on a phone', async () => {
    const { root } = await render();
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    const amount = query(root, '#qa-amount') as HTMLInputElement;
    expect(amount.inputMode).toBe('decimal');
    expect(text(query(root, 'label[for="qa-amount"]'))).toBe('Amount in rupees');
    expect(root.querySelector('input[autofocus]')).toBeNull();
  });

  it('starts with a hint and a disabled Add button', async () => {
    const { root } = await render();
    expect(text(query(root, '.reading'))).toContain('Type an amount and a category');
    expect((query(root, 'button.save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows how the typed text will be read, before anything is sent', async () => {
    const { api, root, type } = await render();
    await type('#qa-amount', '450');
    expect(text(query(root, '.reading'))).toContain('Missing category');
    await type('#qa-category', 'Dinner');
    expect(text(query(root, '.reading'))).toBe('Spent ₹450.00 on dinner · UPI · Tue, 17 Nov');
    expect((query(root, 'button.save') as HTMLButtonElement).disabled).toBe(false);
    expect(api.capture).not.toHaveBeenCalled();
  });

  it('the chips change the method and day, and say which is chosen', async () => {
    const { root, type, chip, settle } = await render();
    await type('#qa-amount', '90');
    await type('#qa-category', 'tea');
    chip('qa-method', 'Cash').click();
    chip('qa-day', 'Yesterday').click();
    await settle();
    expect(chip('qa-method', 'Cash').getAttribute('aria-pressed')).toBe('true');
    expect(chip('qa-method', 'UPI').getAttribute('aria-pressed')).toBe('false');
    expect(text(query(root, '.reading'))).toContain('Cash · Mon, 16 Nov');
  });

  it('switching to Received reads the entry as income', async () => {
    const { root, type, settle } = await render();
    await type('#qa-amount', '5000');
    await type('#qa-category', 'salary');
    const received = must(
      [...root.querySelectorAll<HTMLInputElement>('input[name="direction"]')].find(
        (r) => r.value === 'received',
      ),
    );
    received.click();
    await settle();
    expect(text(query(root, '.reading'))).toContain('Received');
  });

  it('saves, lists the entry, announces it and empties the fields', async () => {
    const { api, root, type, submit } = await render({
      capture: () => Promise.resolve(saved('dinner', 'with friends')),
    });
    await type('#qa-amount', '450');
    await type('#qa-category', 'dinner');
    await type('#qa-note', 'with friends');
    await submit();
    expect(api.capture).toHaveBeenCalledWith('450 dinner with friends upi today', undefined);
    const rows = root.querySelectorAll('.added li');
    expect(rows).toHaveLength(1);
    expect(text(must(rows[0]))).toContain('dinner');
    expect(text(must(rows[0]))).toContain('UPI · Tue, 17 Nov · Pending · with friends');
    expect(text(query(root, '[role=status]'))).toBe('Added spent on dinner, UPI, pending');
    expect((query(root, '#qa-amount') as HTMLInputElement).value).toBe('');
    expect((query(root, 'button.save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers a just-used category as a chip', async () => {
    const { root, type, submit, settle } = await render({
      capture: () => Promise.resolve(saved('dinner')),
    });
    await type('#qa-amount', '450');
    await type('#qa-category', 'dinner');
    await submit();
    const recent = must(
      [...root.querySelectorAll<HTMLButtonElement>('[aria-label="Recent categories"] button')].find(
        (b) => text(b) === 'dinner',
      ),
    );
    recent.click();
    await settle();
    expect((query(root, '#qa-category') as HTMLInputElement).value).toBe('dinner');
  });

  it('puts a refusal in an alert and keeps what was typed', async () => {
    const { root, type, submit } = await render({
      capture: () =>
        Promise.reject(
          new ApiError(422, 'invalid_capture', 'No bank account to record a upi payment in'),
        ),
    });
    await type('#qa-amount', '450');
    await type('#qa-category', 'dinner');
    await submit();
    expect(text(query(root, '[role=alert]'))).toBe('No bank account to record a upi payment in');
    expect((query(root, '#qa-amount') as HTMLInputElement).value).toBe('450');
    expect(root.querySelectorAll('.added li')).toHaveLength(0);
  });

  it('shows untrusted text as text, never as markup', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const { root, type, submit } = await render({
      capture: () => Promise.resolve(saved('dinner', hostile)),
    });
    await type('#qa-amount', '450');
    await type('#qa-category', 'dinner');
    await submit();
    expect(root.querySelector('.added img')).toBeNull();
    expect(text(query(root, '.added li'))).toContain(hostile);
  });

  describe('account choice', () => {
    it('is offered to a token that can read, and sent when picked', async () => {
      const { api, root, type, submit, settle } = await render();
      const select = query(root, '#qa-account') as HTMLSelectElement;
      expect([...select.options].map((o) => o.textContent.trim())).toEqual([
        'Pick from how it was paid',
        'HDFC Bank',
        'ICICI card',
        'Cash',
      ]);
      select.value = 'acc-bank';
      select.dispatchEvent(new Event('change'));
      await settle();
      await type('#qa-amount', '450');
      await type('#qa-category', 'dinner');
      await submit();
      expect(api.capture).toHaveBeenCalledWith('450 dinner upi today', 'acc-bank');
    });

    it('is left out for a capture-only token', async () => {
      const { api, root } = await render({}, true);
      expect(root.querySelector('#qa-account')).toBeNull();
      expect(api.balances).not.toHaveBeenCalled();
    });
  });
});
