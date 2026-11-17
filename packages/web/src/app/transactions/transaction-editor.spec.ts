import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { TransactionChange } from '../api/api-client';
import { must, query } from '../../testing';
import { TRANSACTIONS } from '../../testing-api';
import { TransactionEditor } from './transaction-editor';

const mart = must(TRANSACTIONS.find((t) => t.id === 't-mart'));
const swiggy = must(TRANSACTIONS.find((t) => t.id === 't-swiggy'));

@Component({
  imports: [TransactionEditor],
  template: `<app-transaction-editor
    [tx]="tx()"
    [suggestions]="['Food', 'Groceries']"
    [saving]="saving()"
    [failure]="failure()"
    (save)="saved.push($event)"
    (cancel)="cancelled = cancelled + 1"
  />`,
})
class Host {
  readonly tx = signal(mart);
  readonly saving = signal(false);
  readonly failure = signal<string | null>(null);
  readonly saved: TransactionChange[] = [];
  cancelled = 0;
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const category = (): HTMLInputElement => query(root, 'input') as HTMLInputElement;
  const kind = (): HTMLSelectElement => query(root, 'select') as HTMLSelectElement;
  const type = async (value: string): Promise<void> => {
    category().value = value;
    category().dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const pick = async (value: string): Promise<void> => {
    kind().value = value;
    kind().dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const submit = async (): Promise<void> => {
    query(root, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
  };
  return { fixture, root, host: fixture.componentInstance, category, kind, type, pick, submit };
}

describe('TransactionEditor', () => {
  it('starts from the current category and kind', async () => {
    const { category, kind } = await render();
    expect(category().value).toBe('');
    expect(category().placeholder).toBe('Uncategorised');
    expect(kind().value).toBe('spend');
  });

  it('offers the category names already in use, so spelling stays the same', async () => {
    const { root, category } = await render();
    const list = query(root, `#${category().getAttribute('list') ?? ''}`);
    expect([...list.querySelectorAll('option')].map((o) => o.value)).toEqual(['Food', 'Groceries']);
  });

  it('labels both fields', async () => {
    const { root } = await render();
    expect([...root.querySelectorAll('label')].map((l) => l.textContent.trim())).toEqual([
      'Category',
      'Kind',
    ]);
    expect(query(root, 'label').getAttribute('for')).toBe(query(root, 'input').id);
  });

  it('sends only the category when only that changed', async () => {
    const { host, type, submit } = await render();
    await type('  Groceries ');
    await submit();
    expect(host.saved).toEqual([{ category: 'Groceries' }]);
  });

  it('sends only the kind when only that changed', async () => {
    const { host, pick, submit } = await render();
    await pick('family');
    await submit();
    expect(host.saved).toEqual([{ kind: 'family' }]);
  });

  it('sends both when both changed', async () => {
    const { host, type, pick, submit } = await render();
    await type('Gifts');
    await pick('transfer');
    await submit();
    expect(host.saved).toEqual([{ category: 'Gifts', kind: 'transfer' }]);
  });

  it('clears a category when the box is emptied', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.tx.set(swiggy);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const input = query(root, 'input') as HTMLInputElement;
    expect(input.value).toBe('Food');
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    query(root, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.saved).toEqual([{ category: null }]);
  });

  it('just closes when nothing changed, without calling the server', async () => {
    const { host, type, submit } = await render();
    await type('   ');
    await submit();
    expect(host.saved).toEqual([]);
    expect(host.cancelled).toBe(1);
  });

  it('explains what the chosen kind means, including that a transfer is never spending', async () => {
    const { root, pick } = await render();
    expect(root.textContent).toContain('Counts as spending.');
    await pick('transfer');
    expect(root.textContent).toContain('Never counted as spending.');
  });

  it('shows a failure and the saving state, and can be cancelled', async () => {
    const { fixture, root, host } = await render();
    host.saving.set(true);
    host.failure.set('This token can only read.');
    fixture.detectChanges();
    expect(query(root, 'button[type=submit]').textContent.trim()).toBe('Saving…');
    expect(query(root, 'button[type=submit]').hasAttribute('disabled')).toBe(true);
    expect(query(root, '[role=alert]').textContent).toContain('can only read');
    host.saving.set(false);
    fixture.detectChanges();
    (query(root, 'button[type=button]') as HTMLButtonElement).click();
    expect(host.cancelled).toBe(1);
  });
});
