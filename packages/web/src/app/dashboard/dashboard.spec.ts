import { TestBed } from '@angular/core/testing';
import { ApiClient, ApiError } from '../api/api-client';
import type { FreeResult } from '../api/api-client';
import { decodeMissing } from '../api/models';
import { FORECAST_JSON, FREE, MISSING_JSON, fakeApi } from '../../testing-api';
import { paise } from '@ledger/core';
import { decodeForecast } from '../api/models';
import { query } from '../../testing';
import { Dashboard } from './dashboard';

async function render(over: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi(over);
  TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
  const fixture = TestBed.createComponent(Dashboard);
  await fixture.whenStable();
  fixture.detectChanges();
  return { api, fixture, root: fixture.nativeElement as HTMLElement };
}

const missing: FreeResult = { kind: 'missing-balances', accounts: decodeMissing(MISSING_JSON) };

describe('Dashboard', () => {
  it('shows a loading state before the numbers arrive', () => {
    const api = fakeApi({ free: () => new Promise(() => undefined) });
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Loading your numbers');
  });

  it('leads with free-to-spend and the days to payday', async () => {
    const { root } = await render();
    const hero = query(root, '.hero');
    expect(hero.textContent).toContain('₹32,500.00');
    expect(hero.textContent).toContain('20 days to payday, Mon, 7 Dec');
  });

  it('shows warnings as status messages', async () => {
    const { root } = await render();
    expect(query(root, '.warning').getAttribute('role')).toBe('status');
    expect(query(root, '.warning').textContent).toContain('ICICI card balance is 9 days old.');
  });

  it('shows how the number is worked out, line by line', async () => {
    const { root } = await render();
    const lines = [...query(root, '.breakdown').querySelectorAll('li')].map((li) =>
      li.textContent.replace(/\s+/g, ' ').trim(),
    );
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('Bank and cash');
    expect(lines[0]).toContain('₹50,000.00');
    expect(lines[1]).toContain('Card dues');
  });

  it('forecasts the daily burn and says the money lasts to payday, in words', async () => {
    const { root } = await render();
    const text = root.textContent;
    expect(text).toContain('₹1,200.00');
    expect(text).toContain('Lasts to payday');
    expect(text).toContain('Expected free on payday');
  });

  it('warns in words when free money will run out before payday', async () => {
    const { root } = await render({
      forecast: () =>
        Promise.resolve(
          decodeForecast({ ...FORECAST_JSON, runwayDays: 12, projectedFreePaise: -500 }),
        ),
    });
    expect(root.textContent).toContain('Runs out early');
    expect(root.textContent).toContain('12 days, 8 days short of payday');
  });

  it('says plainly when reserves already use up everything, instead of a runway', async () => {
    const { root } = await render({
      free: () => Promise.resolve({ kind: 'ready', free: { ...FREE, freePaise: paise(-250_000) } }),
      forecast: () =>
        Promise.resolve(
          decodeForecast({ ...FORECAST_JSON, runwayDays: 0, projectedFreePaise: -900_000 }),
        ),
    });
    expect(root.textContent).toContain('Nothing free');
    expect(root.textContent).toContain('already use up everything you have until payday');
    expect(root.textContent).not.toContain('Runs out early');
  });

  it('says so when nothing has been spent recently', async () => {
    const { root } = await render({
      forecast: () => Promise.resolve(decodeForecast({ ...FORECAST_JSON, runwayDays: null })),
    });
    expect(root.textContent).toContain('No spending recorded in the last 14 days.');
  });

  it('lists pots with a labelled meter only when they have a target', async () => {
    const { root } = await render();
    const meters = root.querySelectorAll('meter');
    expect(meters).toHaveLength(1);
    expect(meters[0]?.getAttribute('aria-label')).toBe('Emergency buffer funded');
    expect(meters[0]?.getAttribute('value')).toBe('20');
    expect(root.textContent).toContain('Rent');
    expect(root.textContent).toContain('Due Tue, 1 Dec');
  });

  it('shows an empty state when there are no pots', async () => {
    const { root } = await render({ pots: () => Promise.resolve([]) });
    expect(root.textContent).toContain('No pots yet');
  });

  it('lists card dues and what falls due before payday', async () => {
    const { root } = await render();
    const cards = query(root, '[aria-labelledby=d-cards]').textContent;
    expect(cards).toContain('ICICI card');
    expect(cards).toContain('₹12,000.00');
    expect(cards).toContain('next due Tue, 8 Dec');
    const upcoming = query(root, '[aria-labelledby=d-upcoming]').textContent;
    expect(upcoming).toContain('Streaming');
    expect(upcoming).toContain('Insurance premium');
    expect(upcoming).toContain('Rent');
  });

  it('asks for starting balances when an account has none, and hides the totals', async () => {
    const { root } = await render({ free: () => Promise.resolve(missing) });
    expect(root.textContent).toContain('Set your starting balances');
    expect(root.textContent).toContain('ICICI card');
    expect(root.querySelector('.hero')).toBeNull();
    expect(root.querySelector('header button')).toBeNull();
    expect(root.querySelector('app-record-balances form')).not.toBeNull();
  });

  it('saves balances through the form and closes it', async () => {
    const { api, fixture, root } = await render();
    query(root, 'header button').click();
    fixture.detectChanges();
    const input = query(root, '#bal-acc-bank') as HTMLInputElement;
    input.value = '46000';
    input.dispatchEvent(new Event('input'));
    query(root, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.recordBalance).toHaveBeenCalledWith('acc-bank', 4_600_000);
    expect(root.querySelector('app-record-balances')).toBeNull();
  });

  it('opens and closes the update form from the header button', async () => {
    const { fixture, root } = await render();
    const button = query(root, 'header button');
    expect(button.textContent.trim()).toBe('Update balances');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    fixture.detectChanges();
    expect(root.querySelector('app-record-balances')).not.toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent.trim()).toBe('Close');
  });

  it('shows the problem with a retry when loading fails', async () => {
    let fail = true;
    const { fixture, root } = await render({
      pots: () =>
        fail
          ? Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server'))
          : Promise.resolve([]),
    });
    expect(root.textContent).toContain('Could not load the dashboard');
    expect(root.textContent).toContain('Could not reach the server');
    expect(root.querySelector('.hero')).toBeNull();

    fail = false;
    query(root, 'ui-state-message button').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.hero')).not.toBeNull();
  });
});
