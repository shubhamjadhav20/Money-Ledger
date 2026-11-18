import { TestBed } from '@angular/core/testing';
import { ApiClient, ApiError } from '../api/api-client';
import { PAYDAY_SPLIT, SCHEDULED, fakeApi } from '../../testing-api';
import { must, query } from '../../testing';
import { Payday } from './payday';
import { NEW_RUN_ID } from './payday-store';

const text = (el: Element): string => el.textContent.replace(/\s+/g, ' ').trim();

async function render(over: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi(over);
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: NEW_RUN_ID, useValue: () => 'run-1' },
    ],
  });
  const fixture = TestBed.createComponent(Payday);
  await fixture.whenStable();
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const button = (label: string, within: ParentNode = root): HTMLButtonElement =>
    must(
      [...within.querySelectorAll('button')].find(
        (b) => text(b) === label || b.getAttribute('aria-label') === label,
      ),
      `a "${label}" button`,
    );
  const click = async (label: string, within: ParentNode = root): Promise<void> => {
    button(label, within).click();
    await settle();
  };
  const type = async (selector: string, value: string): Promise<void> => {
    const input = query(root, selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const submit = async (formSelector: string): Promise<void> => {
    query(root, formSelector).dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  const card = (title: string): HTMLElement =>
    must(
      [...root.querySelectorAll<HTMLElement>('ui-card')].find(
        (c) => c.querySelector('h2')?.textContent.trim() === title,
      ),
      `the "${title}" card`,
    );
  return { api, fixture, root, settle, button, click, type, submit, card };
}

const forbidden = () => Promise.reject(new ApiError(403, 'forbidden', 'needs full'));

describe('Payday screen', () => {
  describe('loading', () => {
    it('shows the four cards once loaded', async () => {
      const { root } = await render();
      expect([...root.querySelectorAll('ui-card h2')].map((h) => text(h))).toEqual([
        'When you are paid',
        'Where your salary goes',
        'Try a payday',
        'Scheduled outflows',
      ]);
      expect(text(query(root, 'h1'))).toBe('Payday');
    });

    it('says why it could not load and tries again', async () => {
      let fail = true;
      const { root, click, api } = await render({
        settings: () =>
          fail
            ? Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server'))
            : Promise.resolve({
                paydayDay: 7,
                paydayWeekend: 'previous-weekday',
                cardExposure: 'all_outstanding',
              }),
      });
      expect(must(root.querySelector('[role="alert"]')).textContent).toContain('Could not reach');
      fail = false;
      await click('Try again');
      expect(root.querySelector('ui-card')).not.toBeNull();
      expect(api.settings).toHaveBeenCalledTimes(2);
    });
  });

  describe('settings', () => {
    it('saves a new payday day', async () => {
      const { api, root, type, submit } = await render();
      await type('#ps-day', '5');
      await submit('app-settings-form form');
      expect(api.updateSettings).toHaveBeenCalledWith({ paydayDay: 5 });
      expect((query(root, '#ps-day') as HTMLInputElement).value).toBe('5');
    });

    it('explains a refusal on the settings card only', async () => {
      const { card, type, submit } = await render({ updateSettings: forbidden });
      await type('#ps-day', '5');
      await submit('app-settings-form form');
      expect(text(card('When you are paid'))).toContain('needs a full-access token');
      expect(text(card('Where your salary goes'))).not.toContain('full-access');
    });
  });

  describe('the split', () => {
    it('saves the lines and reloads them', async () => {
      const { api, submit } = await render();
      await submit('app-rules-editor form');
      expect(api.setPaydayRules).toHaveBeenCalledTimes(1);
      expect(api.setPaydayRules.mock.calls[0]?.[0]).toHaveLength(3);
    });

    it('offers the pots as places a line can go', async () => {
      const { root } = await render();
      const options = [...root.querySelectorAll('app-rules-editor select[id$="-pot"] option')].map(
        (o) => text(o),
      );
      expect(options).toContain('Emergency buffer');
      expect(options).toContain('Rent');
      expect(options).toContain('Stays with me');
    });
  });

  describe('a payday run', () => {
    it('shows the split for a salary, then adds it to the pots after confirming', async () => {
      const { api, root, card, type, submit, click } = await render();
      await type('#run-amount', '80,000');
      await submit('app-payday-run form');
      expect(api.previewPayday).toHaveBeenCalledWith(8_000_000);
      expect(text(card('Try a payday'))).toContain('Emergency buffer');

      await click('Add to pots');
      expect(api.applyPayday).not.toHaveBeenCalled();
      await click('Yes, add it');
      expect(api.applyPayday).toHaveBeenCalledWith({ runId: 'run-1', amountPaise: 8_000_000 });
      expect(text(must(root.querySelector('.done')))).toContain('Added to 1 pot');
      expect(api.pots).toHaveBeenCalledTimes(2);
    });

    it('keeps the question open and the run id when adding fails', async () => {
      let fail = true;
      const { api, root, type, submit, click } = await render({
        applyPayday: (input) =>
          fail
            ? Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server'))
            : Promise.resolve({
                runId: input.runId,
                replayed: false,
                result: PAYDAY_SPLIT,
              }),
      });
      await type('#run-amount', '80000');
      await submit('app-payday-run form');
      await click('Add to pots');
      await click('Yes, add it');
      expect(text(must(root.querySelector('.confirm')))).toContain('Add ₹5,000.00');
      expect(must(root.querySelector('[role="alert"]')).textContent).toContain('Could not reach');
      fail = false;
      await click('Yes, add it');
      expect(api.applyPayday).toHaveBeenNthCalledWith(2, {
        runId: 'run-1',
        amountPaise: 8_000_000,
      });
      expect(root.querySelector('.done')).not.toBeNull();
    });

    it('closes the split without adding anything', async () => {
      const { api, root, type, submit, click } = await render();
      await type('#run-amount', '80000');
      await submit('app-payday-run form');
      await click('Close');
      expect(root.querySelector('app-payday-run table')).toBeNull();
      expect(api.applyPayday).not.toHaveBeenCalled();
    });

    it('turns a saved split change into a fresh start for the run', async () => {
      const { root, type, submit } = await render();
      await type('#run-amount', '80000');
      await submit('app-payday-run form');
      expect(root.querySelector('app-payday-run table')).not.toBeNull();
      await submit('app-rules-editor form');
      expect(root.querySelector('app-payday-run table')).toBeNull();
    });

    it('can dismiss the result', async () => {
      const { root, type, submit, click } = await render();
      await type('#run-amount', '80000');
      await submit('app-payday-run form');
      await click('Add to pots');
      await click('Yes, add it');
      await click('Dismiss');
      expect(root.querySelector('.done')).toBeNull();
    });

    it('cannot try a salary until a split is saved', async () => {
      const { root } = await render({ paydayRules: () => Promise.resolve([]) });
      const go = query(root, 'app-payday-run button[type="submit"]') as HTMLButtonElement;
      expect(go.disabled).toBe(true);
    });
  });

  describe('scheduled outflows', () => {
    it('lists each item with when it happens', async () => {
      const { root } = await render();
      const items = [...root.querySelectorAll('.items li')].map((li) => [
        ...[...li.querySelectorAll('.what span')].map((s) => text(s)),
        text(must(li.querySelector('ui-money'))),
      ]);
      expect(items).toEqual([
        ['Rent', 'Every month on the 1st', '₹25,000.00'],
        ['Streaming', 'Every month on the 25th', '₹649.00'],
        ['Insurance premium', 'Sat, 28 Nov', '₹11,000.00'],
      ]);
    });

    it('shows an empty state with a way to add one', async () => {
      const { root } = await render({ scheduled: () => Promise.resolve([]) });
      expect(text(root)).toContain('Nothing scheduled');
    });

    it('adds a monthly item and closes the form', async () => {
      const { api, root, click, type, submit } = await render();
      await click('Add one');
      await type('#sch-name', 'Gym');
      await type('#sch-amount', '1,200');
      await type('#sch-day', '3');
      await submit('app-scheduled-form form');
      expect(api.addScheduled).toHaveBeenCalledWith({
        name: 'Gym',
        amountPaise: 120_000,
        monthlyDay: 3,
      });
      expect(root.querySelector('app-scheduled-form')).toBeNull();
      expect(api.scheduled).toHaveBeenCalledTimes(2);
    });

    it('keeps the form open and says why when adding fails', async () => {
      const { root, click, type, submit } = await render({ addScheduled: forbidden });
      await click('Add one');
      await type('#sch-name', 'Gym');
      await type('#sch-amount', '1200');
      await type('#sch-day', '3');
      await submit('app-scheduled-form form');
      expect(root.querySelector('app-scheduled-form')).not.toBeNull();
      expect(text(must(root.querySelector('app-scheduled-form [role="alert"]')))).toContain(
        'full-access',
      );
    });

    it('closes the form with Close', async () => {
      const { root, click } = await render();
      await click('Add one');
      await click('Close');
      expect(root.querySelector('app-scheduled-form')).toBeNull();
    });

    it('asks before removing, then removes', async () => {
      const { api, click } = await render();
      await click('Remove Streaming');
      expect(api.deleteScheduled).not.toHaveBeenCalled();
      await click('Yes, remove it');
      expect(api.deleteScheduled).toHaveBeenCalledWith('s-tv');
    });

    it('keeps an item when you choose Keep', async () => {
      const { api, root, click } = await render();
      await click('Remove Rent');
      await click('Keep');
      expect(api.deleteScheduled).not.toHaveBeenCalled();
      expect(root.querySelectorAll('.items li')).toHaveLength(SCHEDULED.length);
    });

    it('says why a removal failed', async () => {
      const { root, click } = await render({
        deleteScheduled: () =>
          Promise.reject(new ApiError(404, 'not_found', 'No such scheduled item')),
      });
      await click('Remove Rent');
      await click('Yes, remove it');
      expect(must(root.querySelector('ui-card:last-of-type .problem')).textContent).toContain(
        'No such scheduled item',
      );
    });

    it('clears a pending removal when the add form opens', async () => {
      const { root, click } = await render();
      await click('Remove Rent');
      await click('Add one');
      expect(root.querySelector('.ask')).toBeNull();
    });
  });
});
