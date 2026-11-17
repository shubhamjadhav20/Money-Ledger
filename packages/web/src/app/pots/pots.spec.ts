import { TestBed } from '@angular/core/testing';
import { paise } from '@ledger/core';
import { ApiClient, ApiError } from '../api/api-client';
import type { PotView } from '../api/models';
import { CARD_POT_JSON, POTS, decodePotFixture, fakeApi } from '../../testing-api';
import { must, query } from '../../testing';
import { Pots } from './pots';

const text = (el: Element): string => el.textContent.replace(/\s+/g, ' ').trim();

async function render(over: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi(over);
  TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
  const fixture = TestBed.createComponent(Pots);
  await fixture.whenStable();
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const button = (label: string, within: ParentNode = root): HTMLButtonElement =>
    must(
      [...within.querySelectorAll('button')].find((b) => text(b) === label),
      `a "${label}" button`,
    );
  const click = async (label: string, within: ParentNode = root): Promise<void> => {
    button(label, within).click();
    await settle();
  };
  const cards = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.pots li')];
  const cardOf = (name: string): HTMLElement =>
    must(
      cards().find((c) => text(c).startsWith(name)),
      `the ${name} pot`,
    );
  const type = async (selector: string, value: string): Promise<void> => {
    const input = query(root, selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const submit = async (): Promise<void> => {
    query(root, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  return { api, fixture, root, settle, button, click, cards, cardOf, type, submit };
}

/** A fake server that remembers what is created, renamed and moved, like the real one. */
function liveServer() {
  let pots: PotView[] = [...POTS];
  const over: Parameters<typeof fakeApi>[0] = {
    pots: () => Promise.resolve(pots),
    createPot: (input) => {
      pots = [
        ...pots,
        {
          id: 'pot-new',
          name: input.name,
          kind: input.kind,
          balancePaise: paise(0),
          targetPaise: input.targetPaise ?? null,
          dueDate: input.dueDate ?? null,
          coversCardAccountId: input.coversCardAccountId ?? null,
        },
      ];
      return Promise.resolve('pot-new');
    },
    updatePot: (id, change) => {
      pots = pots.map((p) => (p.id === id ? { ...p, ...change } : p));
      return Promise.resolve(must(pots.find((p) => p.id === id)));
    },
    addPotMovement: (id, input) => {
      pots = pots.map((p) =>
        p.id === id ? { ...p, balancePaise: paise(p.balancePaise + input.amountPaise) } : p,
      );
      return Promise.resolve();
    },
  };
  return over;
}

describe('Pots screen', () => {
  describe('the list', () => {
    it('shows each pot with its kind, balance, target and due date', async () => {
      const { cards, cardOf } = await render();
      expect(cards()).toHaveLength(2);
      const buffer = text(cardOf('Emergency buffer'));
      expect(buffer).toContain('Safety buffer');
      expect(buffer).toContain('₹2,000.00');
      expect(buffer).toContain('of ₹10,000.00 target');
      const meter = query(cardOf('Emergency buffer'), 'meter') as HTMLMeterElement;
      expect(meter.value).toBe(20);
      expect(meter.getAttribute('aria-label')).toBe('Emergency buffer funded');
      const rent = text(cardOf('Rent'));
      expect(rent).toContain('Bill');
      expect(rent).toContain('Due Tue, 1 Dec');
      expect(cardOf('Rent').querySelector('meter')).toBeNull();
    });

    it('says which card a bill pot is set aside for', async () => {
      const covering = decodePotFixture(CARD_POT_JSON);
      const { cardOf } = await render({ pots: () => Promise.resolve([...POTS, covering]) });
      expect(text(cardOf('ICICI card bill'))).toContain('Set aside for ICICI card');
    });

    it('caps the meter at full when a pot holds more than its target', async () => {
      const over = { ...must(POTS[0]), balancePaise: paise(2_500_000) };
      const { cardOf } = await render({ pots: () => Promise.resolve([over]) });
      expect((query(cardOf('Emergency buffer'), 'meter') as HTMLMeterElement).value).toBe(100);
    });

    it('invites you to make the first pot when there are none', async () => {
      const { root } = await render({ pots: () => Promise.resolve([]) });
      expect(text(query(root, 'ui-state-message'))).toContain('No pots yet');
    });

    it('offers a retry when the pots cannot be loaded', async () => {
      let fail = true;
      const { root, settle, click } = await render({
        pots: () =>
          fail
            ? Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server'))
            : Promise.resolve(POTS),
      });
      expect(text(query(root, 'ui-state-message'))).toContain('Could not reach the server');
      expect(root.textContent).not.toContain('New pot');
      fail = false;
      await click('Try again');
      await settle();
      expect(root.querySelectorAll('.pots li')).toHaveLength(2);
    });

    it('renders pot names as text, never as markup', async () => {
      const hostile = { ...must(POTS[0]), name: '<img src=x onerror=alert(1)>' };
      const { root } = await render({ pots: () => Promise.resolve([hostile]) });
      expect(root.querySelector('.pots img')).toBeNull();
      expect(text(root)).toContain('<img src=x onerror=alert(1)>');
    });
  });

  describe('making a pot', () => {
    it('opens the form, creates the pot and shows it in the list', async () => {
      const { api, root, click, type, submit, cards, cardOf } = await render(liveServer());
      await click('New pot');
      expect(root.querySelector('app-pot-form')).not.toBeNull();
      await type('#pf-new-name', 'Trip fund');
      await submit();
      expect(api.createPot).toHaveBeenCalledWith({ name: 'Trip fund', kind: 'buffer' });
      expect(root.querySelector('app-pot-form')).toBeNull();
      expect(cardOf('Trip fund')).toBeTruthy();
      expect(cards()).toHaveLength(3);
    });

    it('keeps the form open and says why when the token is read-only', async () => {
      const { root, click, type, submit, cards } = await render({
        createPot: () =>
          Promise.reject(new ApiError(403, 'forbidden', 'This token cannot do that')),
      });
      await click('New pot');
      await type('#pf-new-name', 'Trip fund');
      await submit();
      expect(root.querySelector('app-pot-form')).not.toBeNull();
      expect(text(query(root, 'app-pot-form [role=alert]'))).toContain('full-access token');
      expect(cards()).toHaveLength(2);
    });

    it('closes the form with Close, and forgets an earlier failure when it is reopened', async () => {
      const { root, click, type, submit } = await render({
        createPot: () => Promise.reject(new ApiError(403, 'forbidden', 'nope')),
      });
      await click('New pot');
      await type('#pf-new-name', 'x');
      await submit();
      await click('Close');
      expect(root.querySelector('app-pot-form')).toBeNull();
      await click('New pot');
      expect(root.querySelector('app-pot-form [role=alert]')).toBeNull();
    });
  });

  describe('changing a pot', () => {
    it('edits a pot and shows the new name', async () => {
      const { api, cardOf, click, type, submit, root } = await render(liveServer());
      await click('Edit', cardOf('Rent'));
      expect(cardOf('Rent').querySelector('app-pot-form')).not.toBeNull();
      await type('#pf-pot-rent-name', 'House rent');
      await submit();
      expect(api.updatePot).toHaveBeenCalledWith('pot-rent', { name: 'House rent' });
      expect(root.querySelector('app-pot-form')).toBeNull();
      expect(text(cardOf('House rent'))).toContain('Due Tue, 1 Dec');
    });

    it('puts money in and shows the new balance', async () => {
      const { api, cardOf, click, type, submit } = await render(liveServer());
      await click('Move money', cardOf('Emergency buffer'));
      await type('#mv-pot-buffer-amount', '1,500');
      await submit();
      expect(api.addPotMovement).toHaveBeenCalledWith('pot-buffer', {
        amountPaise: 150_000,
        reason: 'manual',
      });
      expect(text(cardOf('Emergency buffer'))).toContain('₹3,500.00');
      expect(cardOf('Emergency buffer').querySelector('app-pot-move')).toBeNull();
    });

    it('takes money out', async () => {
      const { cardOf, click, type, submit } = await render(liveServer());
      await click('Move money', cardOf('Emergency buffer'));
      (
        query(cardOf('Emergency buffer'), 'input[type=radio]:not(:checked)') as HTMLInputElement
      ).click();
      await type('#mv-pot-buffer-amount', '500');
      await submit();
      expect(text(cardOf('Emergency buffer'))).toContain('₹1,500.00');
    });

    it('keeps the panel open and says why when the token is read-only', async () => {
      const { cardOf, click, type, submit } = await render({
        addPotMovement: () => Promise.reject(new ApiError(403, 'forbidden', 'nope')),
      });
      await click('Move money', cardOf('Rent'));
      await type('#mv-pot-rent-amount', '100');
      await submit();
      expect(cardOf('Rent').querySelector('app-pot-move')).not.toBeNull();
      expect(text(query(cardOf('Rent'), '[role=alert]'))).toContain('full-access token');
    });

    it('has one panel open at a time, and the same button closes it', async () => {
      const { cardOf, click, root } = await render();
      await click('Edit', cardOf('Rent'));
      expect(root.querySelectorAll('app-pot-form')).toHaveLength(1);
      await click('Move money', cardOf('Emergency buffer'));
      expect(root.querySelectorAll('app-pot-form')).toHaveLength(0);
      expect(root.querySelectorAll('app-pot-move')).toHaveLength(1);
      const chip = must(
        [...cardOf('Emergency buffer').querySelectorAll('button')].find(
          (b) => text(b) === 'Move money',
        ),
      );
      expect(chip.getAttribute('aria-pressed')).toBe('true');
      await click('Move money', cardOf('Emergency buffer'));
      expect(root.querySelectorAll('app-pot-move')).toHaveLength(0);
      expect(chip.getAttribute('aria-pressed')).toBe('false');
    });

    it('closes an open pot panel when a new pot is started', async () => {
      const { cardOf, click, root } = await render();
      await click('Edit', cardOf('Rent'));
      await click('New pot');
      expect(root.querySelectorAll('app-pot-form')).toHaveLength(1);
      expect(cardOf('Rent').querySelector('app-pot-form')).toBeNull();
    });
  });

  describe('history', () => {
    it('lists what went in and out, newest first, in plain words', async () => {
      const { api, cardOf, click } = await render();
      await click('History', cardOf('Emergency buffer'));
      expect(api.potMovements).toHaveBeenCalledWith('pot-buffer');
      const lines = [...cardOf('Emergency buffer').querySelectorAll('.history li')].map((li) => ({
        what: must(li.querySelector('span')?.firstChild?.textContent, 'a label').trim(),
        when: text(query(li as HTMLElement, 'small')),
        amount: text(query(li as HTMLElement, 'ui-money')),
      }));
      expect(lines).toEqual([
        { what: 'Spent from the pot', when: 'Thu, 12 Nov', amount: '-₹1,000.00' },
        { what: 'Payday split', when: 'Sat, 7 Nov', amount: '₹3,000.00' },
      ]);
    });

    it('says when nothing has moved yet', async () => {
      const { cardOf, click } = await render({ potMovements: () => Promise.resolve([]) });
      await click('History', cardOf('Rent'));
      expect(text(query(cardOf('Rent'), '.history'))).toBe('Nothing has been moved in or out yet.');
    });

    it('says when the history cannot be loaded', async () => {
      const { cardOf, click } = await render({
        potMovements: () => Promise.reject(new ApiError(0, 'x', 'down')),
      });
      await click('History', cardOf('Rent'));
      expect(text(query(cardOf('Rent'), '.history [role=alert]'))).toBe(
        "Could not load this pot's history.",
      );
    });

    it('shows the new line after money is moved while the history is open', async () => {
      let entries = [...(await import('../../testing-api')).MOVEMENTS];
      const server = liveServer();
      const { cardOf, click, type, submit } = await render({
        ...server,
        potMovements: () => Promise.resolve(entries),
        addPotMovement: (id, input) => {
          entries = [
            ...entries,
            {
              id: 'm-3',
              amountPaise: input.amountPaise,
              reason: input.reason,
              date: must(entries[0]).date,
            },
          ];
          return must(server.addPotMovement)(id, input);
        },
      });
      await click('History', cardOf('Emergency buffer'));
      expect(cardOf('Emergency buffer').querySelectorAll('.history li')).toHaveLength(2);
      await click('Move money', cardOf('Emergency buffer'));
      await type('#mv-pot-buffer-amount', '50');
      await submit();
      await click('History', cardOf('Emergency buffer'));
      expect(cardOf('Emergency buffer').querySelectorAll('.history li')).toHaveLength(3);
    });
  });
});
