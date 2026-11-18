import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY } from '../theme';
import { must, query } from '../../testing';
import { Gallery } from './gallery';

async function render(): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(Gallery);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('Gallery', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
  });

  it('shows every section with a labelled heading', async () => {
    const el = await render();
    const headings = [...el.querySelectorAll('h2')].map((h) => h.textContent.trim());
    expect(headings).toEqual([
      'Colour',
      'Type and money',
      'Buttons and chips',
      'Cards',
      'Hero and runway',
      'Icons',
      'Table',
      'Empty, loading, error',
    ]);
    for (const section of el.querySelectorAll('section')) {
      expect(section.getAttribute('aria-labelledby')).toBeTruthy();
    }
  });

  it('formats the sample amounts with the shared core formatter', async () => {
    const el = await render();
    const text = el.textContent;
    expect(text).toContain('₹1,23,456.78');
    expect(text).toContain('-₹769.00');
    expect(text).toContain('₹8,381.00');
  });

  it('chips announce their state with aria-pressed and move the selection', async () => {
    const el = await render();
    const group = query(el, '[aria-label="Category"]');
    const chips = [...group.querySelectorAll('button')];
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    must(chips[2]).click();
    await TestBed.inject(ApplicationRef).whenStable();
    expect(
      [...group.querySelectorAll('button')].map((c) => c.getAttribute('aria-pressed')),
    ).toEqual(['false', 'false', 'true', 'false', 'false']);
  });

  it('the theme chips switch and remember the theme', async () => {
    const el = await render();
    const light = [...el.querySelectorAll('[aria-label="Theme"] button')].find(
      (b) => b.textContent.trim() === 'light',
    ) as HTMLButtonElement;
    light.click();
    await TestBed.inject(ApplicationRef).whenStable();
    TestBed.tick();
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(light.getAttribute('aria-pressed')).toBe('true');
  });

  it('the table is accessible: caption, column headers, right-aligned money', async () => {
    const el = await render();
    const table = query(el, 'table');
    expect(table.querySelector('caption')?.textContent).toContain('Recent transactions');
    expect(
      [...table.querySelectorAll('th')].every((th) => th.getAttribute('scope') === 'col'),
    ).toBe(true);
    const amounts = table.querySelectorAll('td.num ui-money');
    expect(amounts.length).toBe(4);
    expect([...amounts].every((m) => m.classList.contains('money'))).toBe(true);
  });

  it('error states are announced as alerts and loading as a busy status', async () => {
    const el = await render();
    expect(el.querySelector('ui-state-message.error')?.getAttribute('role')).toBe('alert');
    const loading = el.querySelector('ui-state-message.loading');
    expect(loading?.getAttribute('role')).toBe('status');
    expect(loading?.getAttribute('aria-busy')).toBe('true');
  });
});
