import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { query } from '../../testing';
import { BALANCES } from '../../testing-api';
import type { BalanceEntry } from './dashboard-store';
import { RecordBalances } from './record-balances';

@Component({
  imports: [RecordBalances],
  template: `<app-record-balances
    [accounts]="accounts"
    [saving]="saving()"
    [failure]="failure()"
    (save)="saved.push($event)"
  />`,
})
class Host {
  readonly accounts = BALANCES;
  readonly saving = signal(false);
  readonly failure = signal<string | null>(null);
  readonly saved: BalanceEntry[][] = [];
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const type = async (id: string, value: string): Promise<void> => {
    const input = query(root, `#bal-${id}`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const submit = async (): Promise<void> => {
    query(root, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
  };
  return { fixture, root, host: fixture.componentInstance, type, submit };
}

describe('RecordBalances', () => {
  it('has one labelled field per account, and says "owe" for a card', async () => {
    const { root } = await render();
    expect([...root.querySelectorAll('label')].map((l) => l.textContent.trim())).toEqual([
      'HDFC Bank (₹)',
      'ICICI card: amount you owe (₹)',
      'Cash (₹)',
    ]);
  });

  it('sends exact paise for what was typed and skips empty rows', async () => {
    const { host, type, submit } = await render();
    await type('acc-bank', '46,000.50');
    await type('acc-cash', '₹ 250');
    await submit();
    expect(host.saved).toEqual([
      [
        { accountId: 'acc-bank', amountPaise: 4_600_050 },
        { accountId: 'acc-cash', amountPaise: 25_000 },
      ],
    ]);
  });

  it('turns the amount owed on a card into a negative balance', async () => {
    const { host, type, submit } = await render();
    await type('acc-card', '9,000');
    await submit();
    expect(host.saved).toEqual([[{ accountId: 'acc-card', amountPaise: -900_000 }]]);
  });

  it('flags an unreadable amount on its own field and sends nothing', async () => {
    const { host, root, type, submit } = await render();
    await type('acc-bank', '12.345');
    await type('acc-cash', '100');
    await submit();
    expect(host.saved).toEqual([]);
    const input = query(root, '#bal-acc-bank');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(query(root, `#${input.getAttribute('aria-describedby') ?? ''}`).textContent).toContain(
      'plain amount',
    );
    expect(query(root, '#bal-acc-cash').getAttribute('aria-invalid')).toBeNull();
  });

  it('rejects a negative amount owed on a card', async () => {
    const { host, root, type, submit } = await render();
    await type('acc-card', '-500');
    await submit();
    expect(host.saved).toEqual([]);
    expect(root.textContent).toContain('Enter what you owe as a positive number.');
  });

  it('does nothing when every row is empty', async () => {
    const { host, submit } = await render();
    await submit();
    expect(host.saved).toEqual([]);
  });

  it('shows the current balance, the saving state and a server failure', async () => {
    const { fixture, root, host } = await render();
    expect(root.textContent).toContain('now ₹45,000.00');
    expect(root.textContent).toContain('you owe ₹12,000.00');
    expect(query(root, 'button[type=submit]').textContent.trim()).toBe('Save balances');

    host.saving.set(true);
    host.failure.set('This token can only read.');
    fixture.detectChanges();
    expect(query(root, 'button[type=submit]').textContent.trim()).toBe('Saving…');
    expect(query(root, 'button[type=submit]').hasAttribute('disabled')).toBe(true);
    expect(query(root, '[role=alert]').textContent).toContain('can only read');
  });
});
