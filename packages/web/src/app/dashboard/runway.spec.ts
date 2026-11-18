import { TestBed } from '@angular/core/testing';
import { Runway, runwayShape } from './runway';

describe('runwayShape', () => {
  it('draws a line that falls from today to payday and sits above zero', () => {
    const shape = runwayShape(1_000_00, 400_00);
    expect(shape.startY).toBeLessThan(shape.endY);
    expect(shape.endY).toBeLessThan(shape.zeroY);
    expect(shape.crossX).toBeNull();
    expect(shape.overdraft).toBe('');
    expect(shape.area).toContain('L100');
  });

  it('marks where the money runs out when the line crosses zero, with the part below it apart', () => {
    const shape = runwayShape(1_000_00, -1_000_00);
    expect(shape.crossX).toBe(50);
    expect(shape.endY).toBeGreaterThan(shape.zeroY);
    expect(shape.overdraft).toBe('M50 ' + String(shape.zeroY) + ' L100 ' + String(shape.endY));
    expect(shape.area).toContain('L50');
  });

  it('puts the crossing nearer today the less money there is', () => {
    const little = runwayShape(100_00, -900_00).crossX;
    const lots = runwayShape(900_00, -100_00).crossX;
    expect(little).toBeLessThan(lots ?? 0);
  });

  it('draws no area when nothing is free, and does not divide by zero when everything is zero', () => {
    expect(runwayShape(-5_00, -9_00).area).toBe('');
    const flat = runwayShape(0, 0);
    expect([flat.startY, flat.endY, flat.zeroY]).toEqual([50, 50, 50]);
    expect(flat.crossX).toBeNull();
  });

  it('keeps a flat line flat when nothing is being spent', () => {
    const shape = runwayShape(500_00, 500_00);
    expect(shape.startY).toBe(shape.endY);
  });
});

describe('Runway', () => {
  it('is hidden from screen readers, because the numbers are written out beside it', () => {
    const fixture = TestBed.createComponent(Runway);
    fixture.componentRef.setInput('free', 100_00);
    fixture.componentRef.setInput('projected', 50_00);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.runway')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelectorAll('.dot')).toHaveLength(2);
  });

  it('adds the "runs out" marker only when the line crosses zero', () => {
    const fixture = TestBed.createComponent(Runway);
    fixture.componentRef.setInput('free', 100_00);
    fixture.componentRef.setInput('projected', -50_00);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.dot.out')).not.toBeNull();
  });
});
