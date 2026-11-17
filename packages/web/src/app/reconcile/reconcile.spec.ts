import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiClient, ApiError } from '../api/api-client';
import { decodeReconcile } from '../api/models';
import type { ReconcileView } from '../api/models';
import { CURRENT_MONTH } from '../month';
import { RECONCILE, RECONCILE_JSON, fakeApi } from '../../testing-api';
import { must, query } from '../../testing';
import { Reconcile } from './reconcile';

const text = (el: Element): string => el.textContent.replace(/\s+/g, ' ').trim();

/** One payment line, split so the name, the detail line and the amount can each be checked. */
function lineParts(li: Element): { name: string; detail: string; amount: string } {
  const what = query(li, '.what');
  const detail = query(what, 'small');
  return {
    name: text(what).replace(text(detail), '').trim(),
    detail: text(detail),
    amount: text(query(li, 'ui-money')),
  };
}

async function render(over: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi(over);
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: CURRENT_MONTH, useValue: '2026-11' },
      provideRouter([]),
    ],
  });
  const fixture = TestBed.createComponent(Reconcile);
  await fixture.whenStable();
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const section = (heading: string): HTMLElement =>
    must(
      [...root.querySelectorAll<HTMLElement>('section')].find(
        (s) => text(query(s, 'h2')) === heading,
      ),
      `the "${heading}" section`,
    );
  return { api, root, settle, section };
}

describe('Reconcile screen', () => {
  it('counts what was found, and says it changes nothing', async () => {
    const { root } = await render();
    const counts = [...root.querySelectorAll('.counts div')].map((d) => [
      text(query(d as HTMLElement, 'dt')),
      text(query(d as HTMLElement, 'dd')),
    ]);
    expect(counts).toEqual([
      ['Matched', '1'],
      ['Please check', '2'],
      ['Need review', '1'],
      ['Ordinary payments', '14'],
    ]);
    expect(text(query(root, '.intro'))).toContain('changes nothing');
  });

  it('shows the sections in order: please check, matched, need review', async () => {
    const { root } = await render();
    expect([...root.querySelectorAll('section h2')].map(text)).toEqual([
      'Please check',
      'Matched',
      'Need review',
    ]);
  });

  it('shows a matched pair with its payments, accounts and the amount it counts as', async () => {
    const { section } = await render();
    const card = section('Matched');
    expect(text(card)).toContain('Matched');
    const lines = [...card.querySelectorAll('.lines li')].map(lineParts);
    expect(lines).toEqual([
      { name: 'AIRLINE ONE', detail: 'Tue, 3 Nov · ICICI card', amount: '-₹6,000.00' },
      { name: 'AIRLINE ONE REFUND', detail: 'Thu, 5 Nov · ICICI card', amount: '₹6,000.00' },
    ]);
    expect(text(query(card, '.net'))).toBe('Counted as ₹0.00');
  });

  it('asks you to check matches whose names differ, and says confirming is not possible yet', async () => {
    const { section } = await render();
    const check = section('Please check');
    expect(text(check)).toContain('Confirming or rejecting a match is not possible yet.');
    expect(check.querySelectorAll('ui-badge')).toHaveLength(2);
    expect(text(check)).toContain('4 payments that match in any order');
    const nets = [...check.querySelectorAll('.net')].map(text);
    expect(nets).toEqual(['Counted as ₹8.00', 'Counted as -₹150.00']);
  });

  it('keeps payments that cannot be paired up apart, and explains why', async () => {
    const { section } = await render();
    const review = section('Need review');
    expect(text(review)).toContain('could be matched in more than one way');
    expect(text(review)).toContain('None of them is netted.');
    expect([...review.querySelectorAll('.lines li')].map((li) => lineParts(li).name)).toEqual([
      'SHOP',
      'MYSTERY',
      'OTHER',
    ]);
  });

  it('asks the server for the opening month and moves between months', async () => {
    const { api, root, settle } = await render();
    expect(api.reconcile).toHaveBeenCalledWith('2026-11-01', '2026-11-30');
    expect(text(query(root, '.month-label'))).toBe('November 2026');
    const next = query(root, '[aria-label="Next month"]') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    query(root, '[aria-label="Previous month"]').click();
    await settle();
    expect(api.reconcile).toHaveBeenLastCalledWith('2026-10-01', '2026-10-31');
    expect(text(query(root, '.month-label'))).toBe('October 2026');
    expect(next.disabled).toBe(false);
  });

  it('says plainly when a month has nothing to match', async () => {
    const quiet: ReconcileView = {
      ...RECONCILE,
      bundles: [],
      unmatched: [],
      singleCount: 9,
      transactions: new Map(),
    };
    const { root } = await render({ reconcile: () => Promise.resolve(quiet) });
    expect(text(query(root, 'ui-state-message'))).toContain('Nothing to match in November 2026');
    expect(root.querySelector('section')).toBeNull();
    expect(query(root, 'a.link-button').getAttribute('href')).toBe('/transactions');
  });

  it('offers a retry when the month cannot be loaded', async () => {
    let fail = true;
    const { root, settle } = await render({
      reconcile: () =>
        fail
          ? Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server'))
          : Promise.resolve(RECONCILE),
    });
    expect(text(query(root, 'ui-state-message'))).toContain('Could not reach the server');
    fail = false;
    must(root.querySelector<HTMLButtonElement>('ui-state-message button')).click();
    await settle();
    expect(root.querySelectorAll('section').length).toBe(3);
  });

  it('shows names from the bank as text, never as markup', async () => {
    const hostile = decodeReconcile({
      ...RECONCILE_JSON,
      transactions: {
        ...RECONCILE_JSON.transactions,
        't-flight': {
          ...RECONCILE_JSON.transactions['t-flight'],
          counterparty: '<img src=x onerror=alert(1)>',
        },
      },
    });
    const { root } = await render({ reconcile: () => Promise.resolve(hostile) });
    expect(root.querySelector('.lines img')).toBeNull();
    expect(text(root)).toContain('<img src=x onerror=alert(1)>');
  });

  it('only reads: the only buttons are the month steps', async () => {
    const { root } = await render();
    expect([...root.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Previous month',
      'Next month',
    ]);
  });
});
