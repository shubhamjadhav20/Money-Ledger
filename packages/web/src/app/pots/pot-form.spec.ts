import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PotChange, PotInput } from '../api/api-client';
import type { AccountBalanceView, PotView } from '../api/models';
import { must, query } from '../../testing';
import { BALANCES, CARD_POT_JSON, POTS, decodePotFixture } from '../../testing-api';
import { PotForm } from './pot-form';

const buffer = must(POTS.find((p) => p.id === 'pot-buffer'));
const rent = must(POTS.find((p) => p.id === 'pot-rent'));
const cards: readonly AccountBalanceView[] = BALANCES.filter((a) => a.kind === 'card');

@Component({
  imports: [PotForm],
  template: `<app-pot-form
    [pot]="pot()"
    [cards]="cards"
    [saving]="saving()"
    [failure]="failure()"
    (create)="created.push($event)"
    (edit)="edited.push($event)"
    (cancel)="cancelled = cancelled + 1"
  />`,
})
class Host {
  readonly pot = signal<PotView | null>(null);
  readonly saving = signal(false);
  readonly failure = signal<string | null>(null);
  readonly cards = cards;
  readonly created: PotInput[] = [];
  readonly edited: PotChange[] = [];
  cancelled = 0;
}

async function render(pot: PotView | null = null) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.pot.set(pot);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const field = (suffix: string): HTMLInputElement & HTMLSelectElement =>
    query(root, `[id$="-${suffix}"]`) as HTMLInputElement & HTMLSelectElement;
  const type = async (suffix: string, value: string): Promise<void> => {
    field(suffix).value = value;
    field(suffix).dispatchEvent(new Event('input'));
    await settle();
  };
  const pick = async (suffix: string, value: string): Promise<void> => {
    field(suffix).value = value;
    field(suffix).dispatchEvent(new Event('change'));
    await settle();
  };
  const submit = async (): Promise<void> => {
    query(root, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  const has = (suffix: string): boolean => root.querySelector(`[id$="-${suffix}"]`) !== null;
  return { fixture, host: fixture.componentInstance, root, type, pick, submit, has, settle };
}

const text = (el: Element): string => el.textContent.replace(/\s+/g, ' ').trim();

describe('PotForm', () => {
  describe('making a pot', () => {
    it('asks for a name, what it is for, and an optional target', async () => {
      const { root, has } = await render();
      expect([...root.querySelectorAll('label')].map(text)).toEqual([
        'Name',
        'What is it for?',
        'Target (₹), optional',
      ]);
      expect([...root.querySelectorAll('#pf-new-kind option')].map(text)).toEqual([
        'Safety buffer',
        'Bill',
        'Spending',
      ]);
      expect(text(query(root, '.hint'))).toBe(
        'Safety money. It is always kept out of free-to-spend.',
      );
      expect(has('due')).toBe(false);
      expect(has('card')).toBe(false);
      expect(text(query(root, 'button[type=submit]'))).toBe('Create pot');
    });

    it('sends a name and kind, and leaves out what was not filled in', async () => {
      const { host, type, submit } = await render();
      await type('name', '  Emergency fund ');
      await submit();
      expect(host.created).toEqual([{ name: 'Emergency fund', kind: 'buffer' }]);
    });

    it('reads the target as exact rupees and paise', async () => {
      const { host, type, pick, submit } = await render();
      await type('name', 'Trip');
      await pick('kind', 'spend');
      await type('target', '₹12,345.50');
      await submit();
      expect(host.created).toEqual([{ name: 'Trip', kind: 'spend', targetPaise: 1_234_550 }]);
    });

    it('offers a due date and a card for a bill, and sends both', async () => {
      const { host, root, type, pick, submit, has } = await render();
      await pick('kind', 'bill');
      expect(has('due')).toBe(true);
      expect([...root.querySelectorAll('#pf-new-card option')].map(text)).toEqual([
        'No card',
        'ICICI card',
      ]);
      await type('name', 'Card bill');
      await type('due', '2026-12-08');
      await pick('card', 'acc-card');
      await submit();
      expect(host.created).toEqual([
        { name: 'Card bill', kind: 'bill', dueDate: '2026-12-08', coversCardAccountId: 'acc-card' },
      ]);
    });

    it('does not send a due date or card typed for a bill after it is changed to something else', async () => {
      const { host, type, pick, submit } = await render();
      await pick('kind', 'bill');
      await type('due', '2026-12-08');
      await pick('card', 'acc-card');
      await pick('kind', 'spend');
      await type('name', 'Fun');
      await submit();
      expect(host.created).toEqual([{ name: 'Fun', kind: 'spend' }]);
    });

    it('explains an empty name, an unreadable target and a negative target, and sends nothing', async () => {
      const { host, root, type, submit } = await render();
      await type('target', 'lots');
      await submit();
      expect(text(query(root, '#pf-new-name-err'))).toBe('Give the pot a name.');
      expect(text(query(root, '#pf-new-target-err'))).toBe('Use a plain amount like 12,345.50.');
      expect(query(root, '#pf-new-name').getAttribute('aria-invalid')).toBe('true');
      await type('target', '-5');
      await submit();
      expect(text(query(root, '#pf-new-target-err'))).toBe('A target cannot be negative.');
      expect(host.created).toEqual([]);
    });

    it('refuses a name longer than the API allows', async () => {
      const { host, root, type, submit } = await render();
      await type('name', 'x'.repeat(61));
      await submit();
      expect(text(query(root, '#pf-new-name-err'))).toBe('Keep the name to 60 characters.');
      expect(host.created).toEqual([]);
    });

    it('shows a failure, and disables Save while saving', async () => {
      const { host, root, settle } = await render();
      host.failure.set(
        'Changing pots needs a full-access token. Connect with one to make changes.',
      );
      host.saving.set(true);
      await settle();
      expect(text(query(root, '[role=alert]'))).toContain('full-access token');
      const save = query(root, 'button[type=submit]') as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      expect(text(save)).toBe('Saving…');
    });

    it('cancels', async () => {
      const { host, root, settle } = await render();
      must(root.querySelector<HTMLButtonElement>('button[type=button]')).click();
      await settle();
      expect(host.cancelled).toBe(1);
    });
  });

  describe('changing a pot', () => {
    it('starts from what the pot has now, and cannot change its kind', async () => {
      const { root, has } = await render(buffer);
      expect((query(root, '#pf-pot-buffer-name') as HTMLInputElement).value).toBe(
        'Emergency buffer',
      );
      expect((query(root, '#pf-pot-buffer-target') as HTMLInputElement).value).toBe('10000');
      expect(has('kind')).toBe(false);
      expect(has('due')).toBe(false);
      expect(text(query(root, 'button[type=submit]'))).toBe('Save');
    });

    it('shows the due date of a bill and no card choice', async () => {
      const { root, has } = await render(rent);
      expect((query(root, '#pf-pot-rent-due') as HTMLInputElement).value).toBe('2026-12-01');
      expect((query(root, '#pf-pot-rent-target') as HTMLInputElement).value).toBe('');
      expect(has('card')).toBe(false);
    });

    it('sends only what changed', async () => {
      const { host, type, submit } = await render(buffer);
      await type('target', '15,000.25');
      await submit();
      expect(host.edited).toEqual([{ targetPaise: 1_500_025 }]);
      expect(host.created).toEqual([]);
    });

    it('clears a target or a due date with null when the field is emptied', async () => {
      const { host, type, submit } = await render(buffer);
      await type('target', '');
      await submit();
      expect(host.edited).toEqual([{ targetPaise: null }]);

      const second = await render(rent);
      await second.type('due', '');
      await second.submit();
      expect(second.host.edited).toEqual([{ dueDate: null }]);
    });

    it('renames, and trims the name', async () => {
      const { host, type, submit } = await render(rent);
      await type('name', ' House rent ');
      await submit();
      expect(host.edited).toEqual([{ name: 'House rent' }]);
    });

    it('closes without sending when nothing changed', async () => {
      const { host, submit } = await render(buffer);
      await submit();
      expect(host.edited).toEqual([]);
      expect(host.cancelled).toBe(1);
    });

    it('offers a due date only on a bill pot', async () => {
      const bill = await render(decodePotFixture(CARD_POT_JSON));
      expect(bill.has('due')).toBe(true);
      const other = await render({ ...buffer, id: 'other' });
      expect(other.has('due')).toBe(false);
    });
  });
});
