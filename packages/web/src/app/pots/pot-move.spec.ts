import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PotMovementInput } from '../api/api-client';
import { must, query } from '../../testing';
import { POTS } from '../../testing-api';
import { PotMove } from './pot-move';

const buffer = must(POTS.find((p) => p.id === 'pot-buffer')); // holds ₹2,000.00

@Component({
  imports: [PotMove],
  template: `<app-pot-move
    [pot]="pot"
    [saving]="saving()"
    [failure]="failure()"
    (move)="moved.push($event)"
    (cancel)="cancelled = cancelled + 1"
  />`,
})
class Host {
  readonly pot = buffer;
  readonly saving = signal(false);
  readonly failure = signal<string | null>(null);
  readonly moved: PotMovementInput[] = [];
  cancelled = 0;
}

const text = (el: Element): string => el.textContent.replace(/\s+/g, ' ').trim();

async function render() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const amount = query(root, '#mv-pot-buffer-amount') as HTMLInputElement;
  const type = async (value: string): Promise<void> => {
    amount.value = value;
    amount.dispatchEvent(new Event('input'));
    await settle();
  };
  const direction = async (index: 0 | 1): Promise<void> => {
    (root.querySelectorAll('input[type=radio]')[index] as HTMLInputElement).click();
    await settle();
  };
  const reason = async (value: string): Promise<void> => {
    const select = query(root, '#mv-pot-buffer-reason') as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  };
  const submit = async (): Promise<void> => {
    query(root, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  return { host: fixture.componentInstance, root, settle, type, direction, reason, submit };
}

describe('PotMove', () => {
  it('puts money in by default, as a positive amount, "moved by hand"', async () => {
    const { host, type, submit } = await render();
    await type('2,500.50');
    await submit();
    expect(host.moved).toEqual([{ amountPaise: 250_050, reason: 'manual' }]);
  });

  it('takes money out as a negative amount, with the chosen reason', async () => {
    const { host, type, direction, reason, submit } = await render();
    await direction(1);
    await reason('spend');
    await type('500');
    await submit();
    expect(host.moved).toEqual([{ amountPaise: -50_000, reason: 'spend' }]);
  });

  it('offers the three reasons in plain words and labels the button by direction', async () => {
    const { root, direction } = await render();
    expect([...root.querySelectorAll('#mv-pot-buffer-reason option')].map(text)).toEqual([
      'Moved by hand',
      'Spent from the pot',
      'Correction',
    ]);
    expect(text(query(root, 'button[type=submit]'))).toBe('Put money in');
    await direction(1);
    expect(text(query(root, 'button[type=submit]'))).toBe('Take money out');
  });

  it.each(['', '0', '-100', 'abc', '1.234'])('refuses "%s" and sends nothing', async (typed) => {
    const { host, root, type, submit } = await render();
    await type(typed);
    await submit();
    expect(text(query(root, '#mv-pot-buffer-err'))).toBe(
      'Enter an amount above zero, like 2,500 or 2,500.50.',
    );
    expect(query(root, '#mv-pot-buffer-amount').getAttribute('aria-invalid')).toBe('true');
    expect(host.moved).toEqual([]);
  });

  it('warns, but still allows it, when taking out more than the pot holds', async () => {
    const { host, root, type, direction, submit } = await render();
    await direction(1);
    await type('2,000.01');
    expect(text(query(root, '[role=status]'))).toContain('more than the pot holds (₹2,000.00)');
    await submit();
    expect(host.moved).toEqual([{ amountPaise: -200_001, reason: 'manual' }]);
  });

  it('does not warn for putting money in, or for taking out exactly what is there', async () => {
    const { root, type, direction } = await render();
    await type('9,999');
    expect(root.querySelector('[role=status]')).toBeNull();
    await direction(1);
    await type('2,000');
    expect(root.querySelector('[role=status]')).toBeNull();
  });

  it('shows a failure and disables the button while saving', async () => {
    const { host, root, settle } = await render();
    host.failure.set('Changing pots needs a full-access token. Connect with one to make changes.');
    host.saving.set(true);
    await settle();
    expect(text(query(root, '[role=alert]'))).toContain('full-access token');
    expect((query(root, 'button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('cancels', async () => {
    const { host, root, settle } = await render();
    must(root.querySelector<HTMLButtonElement>('button[type=button]')).click();
    await settle();
    expect(host.cancelled).toBe(1);
  });
});
