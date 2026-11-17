import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY, ThemeService } from './theme';

const root = (): HTMLElement => document.documentElement;

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    delete root().dataset['theme'];
    TestBed.resetTestingModule();
  });

  it('follows the system by default and sets no data-theme', () => {
    const theme = TestBed.inject(ThemeService);
    TestBed.tick();
    expect(theme.choice()).toBe('system');
    expect(root().dataset['theme']).toBeUndefined();
  });

  it('applies and remembers an explicit choice', () => {
    const theme = TestBed.inject(ThemeService);
    theme.set('light');
    TestBed.tick();
    expect(root().dataset['theme']).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    theme.set('system');
    TestBed.tick();
    expect(root().dataset['theme']).toBeUndefined();
  });

  it('reads a stored choice and ignores a stored value it does not recognise', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(TestBed.inject(ThemeService).choice()).toBe('dark');
    TestBed.resetTestingModule();
    localStorage.setItem(THEME_STORAGE_KEY, '<script>');
    expect(TestBed.inject(ThemeService).choice()).toBe('system');
  });

  it('still works when storage throws (private windows, blocked site data)', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const theme = TestBed.inject(ThemeService);
    theme.set('dark');
    TestBed.tick();
    expect(theme.choice()).toBe('dark');
    expect(root().dataset['theme']).toBe('dark');
    get.mockRestore();
    set.mockRestore();
  });
});
