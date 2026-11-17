import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiClient, ApiError } from '../api/api-client';
import { IMPORT_PLAN, PENDING, fakeApi, planFor } from '../../testing-api';
import { must, query } from '../../testing';
import { ImportScreen } from './import-screen';

const CSV = 'Date,Narration\n01/10/2026,UPI/CHAI POINT\n';

async function render(over: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi({ transactions: () => Promise.resolve(PENDING), ...over });
  TestBed.configureTestingModule({
    providers: [{ provide: ApiClient, useValue: api }, provideRouter([])],
  });
  const fixture = TestBed.createComponent(ImportScreen);
  await fixture.whenStable();
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const select = async (id: string, value: string): Promise<void> => {
    const el = query(root, id) as HTMLSelectElement;
    el.value = value;
    el.dispatchEvent(new Event('change'));
    await settle();
  };
  const attach = async (name: string, text: string): Promise<void> => {
    const input = query(root, '#imp-file') as HTMLInputElement;
    const file = { name, text: () => Promise.resolve(text) };
    Object.defineProperty(input, 'files', {
      value: { item: (n: number) => (n === 0 ? file : null), length: 1 },
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await settle();
  };
  const preview = async (): Promise<void> => {
    await select('#imp-account', 'acc-bank');
    await select('#imp-layout', 'fakebank-savings');
    await attach('oct.csv', CSV);
    query(root, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  return { api, fixture, root, settle, select, attach, preview };
}

const text = (el: Element): string => el.textContent.replace(/\s+/g, ' ').trim();

describe('Import screen', () => {
  describe('choosing a file', () => {
    it('has labelled fields, offers bank and card accounts but not cash, and the known layouts', async () => {
      const { root } = await render();
      expect([...root.querySelectorAll('label')].map((l) => text(l))).toEqual([
        'Account',
        'Statement layout',
        'Statement file (CSV)',
      ]);
      const accounts = [...root.querySelectorAll('#imp-account option')].map((o) => text(o));
      expect(accounts).toEqual(['Choose an account', 'HDFC Bank', 'ICICI card']);
      const layouts = [...root.querySelectorAll('#imp-layout option')].map((o) => text(o));
      expect(layouts).toEqual([
        'Choose a layout',
        'FakeBank savings (demo)',
        'DemoCard credit card (demo)',
      ]);
      expect((query(root, '#imp-file') as HTMLInputElement).accept).toBe('.csv,text/csv');
    });

    it('keeps Preview disabled until an account, a layout and a file are chosen', async () => {
      const { root, select, attach } = await render();
      const button = query(root, 'form button[type=submit]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      await select('#imp-account', 'acc-bank');
      await select('#imp-layout', 'fakebank-savings');
      expect(button.disabled).toBe(true);
      await attach('oct.csv', CSV);
      expect(button.disabled).toBe(false);
      expect(text(root)).toContain('Ready: oct.csv');
    });

    it('says so when the file is empty or cannot be read', async () => {
      const { root, attach, fixture } = await render();
      await attach('empty.csv', '');
      expect(text(query(root, '#imp-file').parentElement ?? root)).toContain('That file is empty.');
      const input = query(root, '#imp-file') as HTMLInputElement;
      Object.defineProperty(input, 'files', {
        value: { item: () => ({ name: 'x.csv', text: () => Promise.reject(new Error('nope')) }) },
        configurable: true,
      });
      input.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(text(root)).toContain('Could not read that file.');
    });

    it('offers a retry when the accounts cannot be loaded', async () => {
      let fail = true;
      const { root, settle } = await render({
        balances: () =>
          fail ? Promise.reject(new ApiError(0, 'unreachable', 'x')) : Promise.resolve([]),
      });
      expect(text(root)).toContain('Could not load your accounts');
      fail = false;
      query(root, 'ui-state-message button').click();
      await settle();
      expect(root.querySelector('ui-state-message')).toBeNull();
    });

    it('explains a read-only token in a banner and stays on this step', async () => {
      const { root, preview } = await render({
        previewImport: () => Promise.reject(new ApiError(403, 'forbidden', 'needs full')),
      });
      await preview();
      expect(text(query(root, '.banner'))).toBe(
        'Importing needs a full-access token. Connect with one to import.',
      );
      expect(root.querySelector('.counts')).toBeNull();
    });
  });

  describe('reviewing', () => {
    it('shows what would happen, in counts, before anything is saved', async () => {
      const { root, preview } = await render();
      await preview();
      const counts = [...root.querySelectorAll('.counts div')].map((d) => ({
        label: text(query(d as HTMLElement, 'dt')),
        value: text(query(d as HTMLElement, 'dd')),
      }));
      expect(counts).toEqual([
        { label: 'New transactions', value: '2' },
        { label: 'Complete entries you added', value: '1' },
        { label: 'Already imported', value: '3' },
        { label: 'Need your decision', value: '1' },
      ]);
      expect(text(root)).toContain('Into HDFC Bank. Nothing has been saved yet.');
    });

    it('lists new rows and the entries that would be completed, as collapsible sections', async () => {
      const { root, preview } = await render();
      await preview();
      const sections = [...root.querySelectorAll('details.list')].map((d) =>
        text(query(d as HTMLElement, 'summary')),
      );
      expect(sections).toEqual(['Complete 1 entry you added', '2 new transactions']);
      const body = text(root);
      expect(body).toContain('UPI/CINEMA HALL');
      expect(body).toContain('-₹18,000.00');
      expect(body).toContain('matches "chai"');
    });

    it('asks which of your entries each ambiguous row is, with the details of each', async () => {
      const { root, preview } = await render();
      await preview();
      const group = query(root, 'fieldset.pick');
      expect(text(query(group, 'legend'))).toContain('UPI/BAKERY THREE');
      const options = [...group.querySelectorAll('label.option')].map((l) => text(l));
      expect(options).toHaveLength(3);
      expect(options[0]).toContain('bakery');
      expect(options[0]).toContain('UPI');
      expect(options[0]).toContain('-₹175.39');
      expect(options[1]).toContain('bread and cake');
      expect(options[2]).toContain('None of these: it is a separate payment');
      expect(group.querySelectorAll('input[type=radio]')).toHaveLength(3);
    });

    it('re-plans when a choice is made and keeps the picker so it can be changed', async () => {
      const { api, root, preview, settle } = await render({
        previewImport: (request) => Promise.resolve(planFor(request)),
      });
      await preview();
      (root.querySelectorAll('fieldset.pick input[type=radio]')[1] as HTMLInputElement).click();
      await settle();
      expect(api.previewImport).toHaveBeenLastCalledWith(
        expect.objectContaining({ choices: { 'k-bakery#1': 'p-bakery-b' } }),
      );
      const needDecision = [...root.querySelectorAll('.counts div')].find((d) =>
        text(d).startsWith('Need your decision'),
      );
      expect(text(must(needDecision))).toContain('0');
      const radios = [
        ...root.querySelectorAll<HTMLInputElement>('fieldset.pick input[type=radio]'),
      ];
      expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
      expect(text(query(root, 'button[type=button]'))).toContain('Import 4 transactions');
    });

    it('warns when an entry was picked for two rows', async () => {
      const { root, preview, settle } = await render(); // the default plan stays ambiguous
      await preview();
      (root.querySelectorAll('fieldset.pick input[type=radio]')[0] as HTMLInputElement).click();
      await settle();
      expect(text(query(root, 'fieldset.pick [role=alert]'))).toContain(
        'also chosen for another row',
      );
    });

    it('shows rows that cannot be read, blocks the import, and renders their text as text', async () => {
      const issues = [
        { line: 0, reason: 'Header row not found (expected: Txn Date)' },
        { line: 7, reason: 'Unknown marker "<img src=x onerror=alert(1)>"' },
      ];
      const { root, preview } = await render({
        previewImport: () => Promise.resolve({ ...IMPORT_PLAN, issues }),
      });
      await preview();
      const card = query(root, '.issues');
      expect(text(card)).toContain('The file: Header row not found');
      expect(text(card)).toContain('Line 7:');
      expect(card.querySelector('img')).toBeNull();
      expect(text(card)).toContain('<img src=x onerror=alert(1)>');
      const confirm = must(
        [...root.querySelectorAll('button')].find((b) => text(b).startsWith('Import')),
      );
      expect(confirm.disabled).toBe(true);
    });

    it('counts the rows it will not show when there are many problems', async () => {
      const issues = Array.from({ length: 12 }, (_, i) => ({ line: i + 2, reason: 'Bad date' }));
      const { root, preview } = await render({
        previewImport: () => Promise.resolve({ ...IMPORT_PLAN, issues }),
      });
      await preview();
      expect(root.querySelectorAll('.issues li')).toHaveLength(8);
      expect(text(query(root, '.issues'))).toContain('and 4 more problems');
    });

    it('renders bank text from the file as text, never as markup', async () => {
      const hostile = { ...must(IMPORT_PLAN.toInsert[0]), counterparty: '<b>bold</b><img src=x>' };
      const { root, preview } = await render({
        previewImport: () => Promise.resolve({ ...IMPORT_PLAN, toInsert: [hostile] }),
      });
      await preview();
      expect(root.querySelector('details.list b')).toBeNull();
      expect(root.querySelector('details.list img')).toBeNull();
      expect(text(root)).toContain('<b>bold</b><img src=x>');
    });

    it('says plainly when there is nothing new', async () => {
      const { root, preview } = await render({
        previewImport: () =>
          Promise.resolve({
            ...IMPORT_PLAN,
            toInsert: [],
            merges: [],
            ambiguous: [],
            duplicateCount: 12,
          }),
      });
      await preview();
      expect(text(root)).toContain('Nothing new to import');
      expect(text(root)).toContain('Every row in this file is already in your ledger.');
    });

    it('says how many undecided rows will be left out', async () => {
      const { root, preview } = await render();
      await preview();
      expect(text(query(root, '[role=status]'))).toContain(
        '1 row still undecided will not be imported this time.',
      );
    });

    it('goes back to choosing a file', async () => {
      const { root, preview, settle } = await render();
      await preview();
      const back = [...root.querySelectorAll('button')].find(
        (b) => text(b) === 'Choose a different file',
      );
      must(back).click();
      await settle();
      expect(root.querySelector('#imp-file')).not.toBeNull();
      expect((query(root, '#imp-account') as HTMLSelectElement).value).toBe('acc-bank');
    });
  });

  describe('confirming', () => {
    it('imports, then shows what happened and where to look', async () => {
      const { api, root, preview, settle } = await render();
      await preview();
      const confirm = must(
        [...root.querySelectorAll('button')].find((b) => text(b).startsWith('Import 3')),
      );
      expect(confirm.disabled).toBe(false);
      confirm.click();
      await settle();
      expect(api.confirmImport).toHaveBeenCalledWith({
        accountId: 'acc-bank',
        mappingId: 'fakebank-savings',
        csv: CSV,
      });
      expect(text(root)).toContain('Imported 3 transactions');
      const lines = [...root.querySelectorAll('.done li')].map((li) => text(li));
      expect(lines).toEqual([
        'New transactions2',
        'Entries you added, now completed1',
        'Already imported, skipped3',
        'Left out, still undecided1',
      ]);
      expect(query(root, 'a.link-button').getAttribute('href')).toBe('/transactions');
    });

    it('can start another import from the result', async () => {
      const { root, preview, settle } = await render();
      await preview();
      [...root.querySelectorAll('button')].find((b) => text(b).startsWith('Import 3'))?.click();
      await settle();
      const again = [...root.querySelectorAll('button')].find(
        (b) => text(b) === 'Import another file',
      );
      must(again).click();
      await settle();
      expect(root.querySelector('#imp-file')).not.toBeNull();
      expect(text(root)).not.toContain('Ready:');
    });

    it('shows the failure and stays on the review when confirming fails', async () => {
      const { root, preview, settle } = await render({
        confirmImport: () =>
          Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server')),
      });
      await preview();
      [...root.querySelectorAll('button')].find((b) => text(b).startsWith('Import 3'))?.click();
      await settle();
      expect(text(query(root, '.banner'))).toBe('Could not reach the server');
      expect(root.querySelector('.counts')).not.toBeNull();
    });
  });
});
