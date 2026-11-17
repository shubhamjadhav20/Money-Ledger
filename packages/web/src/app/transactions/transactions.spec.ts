import { TestBed } from '@angular/core/testing';
import { ApiClient, ApiError } from '../api/api-client';
import { CURRENT_MONTH } from '../month';
import { TRANSACTIONS, fakeApi } from '../../testing-api';
import { must, query } from '../../testing';
import { Transactions } from './transactions';

async function render(over: Parameters<typeof fakeApi>[0] = {}, month = '2026-11') {
  const api = fakeApi(over);
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: CURRENT_MONTH, useValue: month },
    ],
  });
  const fixture = TestBed.createComponent(Transactions);
  await fixture.whenStable();
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.row')];
  const row = (id: string): HTMLElement => must(rows()[TRANSACTIONS.findIndex((t) => t.id === id)]);
  return { api, fixture, root, settle, rows, row };
}

const text = (el: Element): string => el.textContent.replace(/\s+/g, ' ').trim();

describe('Transactions screen', () => {
  it('shows a loading state before anything arrives', () => {
    const api = fakeApi({ transactions: () => new Promise(() => undefined) });
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: CURRENT_MONTH, useValue: '2026-11' },
      ],
    });
    const fixture = TestBed.createComponent(Transactions);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Loading transactions');
  });

  it('lists the month newest first with date, account, method, status, kind and category', async () => {
    const { rows } = await render();
    expect(rows()).toHaveLength(5);
    const swiggy = text(must(rows()[1]));
    expect(swiggy).toContain('Swiggy');
    expect(swiggy).toContain('dinner');
    expect(swiggy).toContain('Mon, 16 Nov');
    expect(swiggy).toContain('HDFC Bank');
    expect(swiggy).toContain('UPI');
    expect(swiggy).toContain('Posted');
    expect(swiggy).toContain('Spend');
    expect(swiggy).toContain('Food');
    expect(swiggy).toContain('-₹450.00');
  });

  it('writes money with its sign in the text, and a plus for money in', async () => {
    const { row } = await render();
    expect(text(row('t-salary'))).toContain('+₹85,000.00');
    expect(text(row('t-mart'))).toContain('-₹1,200.00');
  });

  it('says a pending entry is pending, falls back to the memo as its name, and flags no category', async () => {
    const { row } = await render();
    const chai = text(row('t-chai'));
    expect(chai).toContain('chai');
    expect(chai).toContain('Pending');
    expect(chai).toContain('Cash');
    expect(text(row('t-mart'))).toContain('Uncategorised');
  });

  it('marks a transfer as a transfer', async () => {
    const { row } = await render();
    expect(text(row('t-cardpay'))).toContain('Transfer');
  });

  it('shows the month at a glance, including that transfers are not spending', async () => {
    const { root } = await render();
    const card = text(query(root, '.summary'));
    expect(card).toContain('November 2026 at a glance');
    const stats = [...query(root, '.stats').querySelectorAll('div')].map((d) => ({
      label: text(query(d, 'dt')),
      amount: text(query(d, 'dd')),
    }));
    expect(stats).toEqual([
      { label: 'Income', amount: '₹85,000.00' },
      { label: 'Spent', amount: '₹1,900.00' },
      { label: 'Invested', amount: '₹0.00' },
      { label: 'Family', amount: '₹0.00' },
      { label: 'Left over', amount: '₹83,100.00' },
    ]);
    expect(card).toContain('1 transfer between your own accounts, not counted as spending.');
    expect(card).toContain('Uncategorised ₹1,200.00');
    expect(card).toContain('Food ₹700.00');
  });

  it('renders text from the bank as text, never as markup', async () => {
    const hostile = {
      ...must(TRANSACTIONS[1]),
      counterparty: '<img src=x onerror=alert(1)>',
      memo: '<b>bold</b>',
    };
    const { root } = await render({ transactions: () => Promise.resolve([hostile]) });
    expect(root.querySelector('.rows img')).toBeNull();
    expect(root.querySelector('.rows b')).toBeNull();
    expect(text(query(root, '.rows'))).toContain('<img src=x onerror=alert(1)>');
  });

  describe('month', () => {
    it('steps back, disables forward on the current month, and labels the move', async () => {
      const { api, root, settle } = await render();
      const next = query(root, '[aria-label="Next month"]') as HTMLButtonElement;
      expect(next.disabled).toBe(true);
      expect(text(query(root, '.month-label'))).toBe('November 2026');

      query(root, '[aria-label="Previous month"]').click();
      await settle();
      expect(text(query(root, '.month-label'))).toBe('October 2026');
      expect(api.summary).toHaveBeenLastCalledWith('2026-10');
      expect(next.disabled).toBe(false);
    });
  });

  describe('search and filters', () => {
    it('searches on submit and keeps the text', async () => {
      const { api, root, settle } = await render();
      const box = query(root, '#tx-search') as HTMLInputElement;
      box.value = 'swiggy';
      query(root, 'form[role=search]').dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();
      expect(api.transactions).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'swiggy' }),
      );
      expect(box.value).toBe('swiggy');
    });

    it('filters by status through the server', async () => {
      const { api, root, settle } = await render();
      const select = query(root, '#tx-status') as HTMLSelectElement;
      select.value = 'pending';
      select.dispatchEvent(new Event('change'));
      await settle();
      expect(api.transactions).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'pending' }),
      );
    });

    it('filters by kind on the page', async () => {
      const { api, root, rows, settle } = await render();
      api.transactions.mockClear();
      const select = query(root, '#tx-kind') as HTMLSelectElement;
      select.value = 'income';
      select.dispatchEvent(new Event('change'));
      await settle();
      expect(rows()).toHaveLength(1);
      expect(text(must(rows()[0]))).toContain('Employer Pvt Ltd');
      expect(api.transactions).not.toHaveBeenCalled();
      expect(text(query(root, '.count'))).toBe('1 transaction');
    });

    it('offers Clear only while filtering, and says so when nothing matches', async () => {
      const { root, settle } = await render({ transactions: () => Promise.resolve([]) });
      expect(text(root)).toContain('No transactions in November 2026');
      expect(root.querySelector('form button[type=button]')).toBeNull();

      const select = query(root, '#tx-kind') as HTMLSelectElement;
      select.value = 'family';
      select.dispatchEvent(new Event('change'));
      await settle();
      expect(text(root)).toContain('Nothing matches');
      expect(text(query(root, 'form button[type=button]'))).toBe('Clear');
    });
  });

  it('notes when the list is cut off at the page limit', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      ...must(TRANSACTIONS[1]),
      id: `t${String(i)}`,
    }));
    const { root } = await render({ transactions: () => Promise.resolve(many) });
    expect(text(query(root, '.count'))).toContain(
      '(the latest 200; search or filter to narrow down)',
    );
  });

  it('shows the problem with a retry when loading fails, then recovers', async () => {
    let fail = true;
    const { root, rows, settle } = await render({
      transactions: () =>
        fail
          ? Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server'))
          : Promise.resolve(TRANSACTIONS),
    });
    expect(text(root)).toContain('Could not load transactions');
    expect(text(root)).toContain('Could not reach the server');
    fail = false;
    query(root, 'ui-state-message button').click();
    await settle();
    expect(rows()).toHaveLength(5);
  });

  describe('editing', () => {
    it('opens a form for one row, labelled by what it edits, and closes it again', async () => {
      const { root, row, settle } = await render();
      const button = query(row('t-mart'), '.edit');
      expect(button.getAttribute('aria-label')).toBe('Edit Metro Mart');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      button.click();
      await settle();
      expect(root.querySelectorAll('app-transaction-editor')).toHaveLength(1);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(text(button)).toBe('Close');
      button.click();
      await settle();
      expect(root.querySelector('app-transaction-editor')).toBeNull();
    });

    it('saves a new category, closes the form and shows the change', async () => {
      const { api, row, settle } = await render();
      query(row('t-mart'), '.edit').click();
      await settle();
      const input = query(row('t-mart'), 'input') as HTMLInputElement;
      input.value = 'Groceries';
      input.dispatchEvent(new Event('input'));
      query(row('t-mart'), 'form').dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();
      expect(api.updateTransaction).toHaveBeenCalledWith('t-mart', { category: 'Groceries' });
      expect(row('t-mart').querySelector('app-transaction-editor')).toBeNull();
    });

    it('keeps the form open with a clear message when the token is read-only', async () => {
      const { row, settle } = await render({
        updateTransaction: () => Promise.reject(new ApiError(403, 'forbidden', 'Needs full')),
      });
      query(row('t-mart'), '.edit').click();
      await settle();
      const select = query(row('t-mart'), 'select') as HTMLSelectElement;
      select.value = 'family';
      select.dispatchEvent(new Event('change'));
      query(row('t-mart'), 'form').dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();
      expect(text(query(row('t-mart'), '[role=alert]'))).toContain('This token can only read.');
      expect(row('t-mart').querySelector('app-transaction-editor')).not.toBeNull();
    });
  });
});
