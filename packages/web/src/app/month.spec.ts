import { TestBed } from '@angular/core/testing';
import { CURRENT_MONTH, formatMonth, monthRange, shiftMonth } from './month';

describe('month helpers', () => {
  it('gives the first and last day of a month, leap years included', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2027-02').to).toBe('2027-02-28');
    expect(monthRange('2026-12').to).toBe('2026-12-31');
  });

  it('moves between months across year ends', () => {
    expect(shiftMonth('2026-11', 1)).toBe('2026-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(shiftMonth('2026-11', -12)).toBe('2025-11');
    expect(shiftMonth('2026-11', 0)).toBe('2026-11');
  });

  it('writes a month the way people say it', () => {
    expect(formatMonth('2026-11')).toBe('November 2026');
    expect(formatMonth('2027-01')).toBe('January 2027');
  });

  it.each(['2026-13', '2026-00', '2026-1', 'November', '2026-11-01'])('rejects %s', (bad) => {
    expect(() => monthRange(bad)).toThrow(/Expected a month/);
    expect(() => shiftMonth(bad, 1)).toThrow(RangeError);
    expect(() => formatMonth(bad)).toThrow(RangeError);
  });

  it('opens on the current month in India by default', () => {
    expect(TestBed.inject(CURRENT_MONTH)).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});
