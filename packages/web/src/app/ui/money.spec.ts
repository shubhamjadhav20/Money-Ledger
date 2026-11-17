import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { paise } from '@ledger/core';
import type { Paise } from '@ledger/core';
import { query } from '../../testing';
import { UiMoney } from './money';
import type { MoneyTone } from './money';

@Component({
  imports: [UiMoney],
  template: '<ui-money [amount]="amount()" [tone]="tone()" [showPlus]="plus()" size="lg" />',
})
class Host {
  readonly amount = signal<Paise>(paise(0));
  readonly tone = signal<MoneyTone>('auto');
  readonly plus = signal(false);
}

async function render(): Promise<{ host: Host; el: () => HTMLElement }> {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const el = (): HTMLElement => {
    fixture.detectChanges();
    return query(fixture.nativeElement as HTMLElement, 'ui-money');
  };
  return { host: fixture.componentInstance, el };
}

describe('UiMoney', () => {
  it('formats integer paise with Indian grouping and exactly two decimals', async () => {
    const { host, el } = await render();
    host.amount.set(paise(12_345_678));
    expect(el().textContent).toBe('₹1,23,456.78');
    host.amount.set(paise(5));
    expect(el().textContent).toBe('₹0.05');
  });

  it('carries the sign in the text and colours by sign', async () => {
    const { host, el } = await render();
    host.amount.set(paise(-76_900));
    expect(el().textContent).toBe('-₹769.00');
    expect(el().classList).toContain('negative');
    host.amount.set(paise(70_000));
    expect(el().classList).toContain('positive');
  });

  it('never colours zero, and neutral tone never colours anything', async () => {
    const { host, el } = await render();
    host.amount.set(paise(0));
    expect(el().classList).not.toContain('positive');
    expect(el().classList).not.toContain('negative');
    host.amount.set(paise(-500));
    host.tone.set('neutral');
    expect(el().classList).not.toContain('negative');
  });

  it('shows a plus on positive amounts only when asked', async () => {
    const { host, el } = await render();
    host.amount.set(paise(50_000));
    expect(el().textContent).toBe('₹500.00');
    host.plus.set(true);
    expect(el().textContent).toBe('+₹500.00');
    host.amount.set(paise(-50_000));
    expect(el().textContent).toBe('-₹500.00');
  });

  it('always has the money class so digits line up (tabular-nums)', async () => {
    const { el } = await render();
    expect(el().classList).toContain('money');
  });
});
