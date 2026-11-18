import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Where the free-money line sits, in a 100 x 100 box (y grows downwards). All numbers are percentages. */
export interface RunwayShape {
  readonly startY: number;
  readonly endY: number;
  readonly zeroY: number;
  /** Where the line meets zero (x), or null when it never goes below it before payday. */
  readonly crossX: number | null;
  readonly line: string;
  /** The filled area under the part of the line that is above zero, or '' when there is none. */
  readonly area: string;
  /** The part of the line below zero (money you would not have), or '' when there is none. */
  readonly overdraft: string;
}

const TOP = 14;
const BOTTOM = 86;

const round = (n: number): number => Math.round(n * 100) / 100;

/** One SVG path point, like `L50 20`. */
const point = (command: 'M' | 'L', x: number, y: number): string =>
  command + String(x) + ' ' + String(y);

/**
 * A straight line from the free money today to the free money expected on payday: that is exactly
 * what the forecast says (it spends a fixed amount a day), so the picture shows no more than the
 * numbers do. Amounts are integer paise; the maths here is only for where to draw.
 */
export function runwayShape(free: number, projected: number): RunwayShape {
  const high = Math.max(free, projected, 0);
  const low = Math.min(free, projected, 0);
  const span = high - low;
  const y = (value: number): number =>
    span === 0 ? 50 : round(BOTTOM - ((value - low) / span) * (BOTTOM - TOP));
  const startY = y(free);
  const endY = y(projected);
  const zeroY = y(0);
  const crossX = free > 0 && projected < 0 ? round((free / (free - projected)) * 100) : null;
  const end = crossX ?? 100;
  const endAtEdge = crossX === null ? endY : zeroY;
  return {
    startY,
    endY,
    zeroY,
    crossX,
    line: [point('M', 0, startY), point('L', 100, endY)].join(' '),
    area:
      free > 0
        ? [
            point('M', 0, zeroY),
            point('L', 0, startY),
            point('L', end, endAtEdge),
            point('L', end, zeroY),
            'Z',
          ].join(' ')
        : '',
    overdraft: crossX === null ? '' : [point('M', crossX, zeroY), point('L', 100, endY)].join(' '),
  };
}

/**
 * The payday runway: how the free money runs down from today to payday. Decorative: every number
 * it shows is also written out as text next to it, so it is hidden from screen readers.
 */
@Component({
  selector: 'app-runway',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="runway" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <line class="zero" x1="0" x2="100" [attr.y1]="shape().zeroY" [attr.y2]="shape().zeroY" />
        @if (shape().area) {
          <path class="area" [attr.d]="shape().area" />
        }
        <path class="line" [attr.d]="shape().line" />
        @if (shape().overdraft) {
          <path class="line over" [attr.d]="shape().overdraft" />
        }
      </svg>
      <span class="dot start" [style.top.%]="shape().startY"></span>
      <span class="dot end" [style.top.%]="shape().endY"></span>
      @if (shape().crossX !== null) {
        <span class="dot out" [style.left.%]="shape().crossX" [style.top.%]="shape().zeroY"></span>
      }
      <span class="tick today">Today</span>
      <span class="tick payday">Payday</span>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .runway {
      position: relative;
      height: 6.5rem;
      margin: var(--space-3) var(--space-2) var(--space-5);
    }
    svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .zero {
      stroke: var(--color-hero-line);
      stroke-width: 1;
      stroke-dasharray: 3 4;
      vector-effect: non-scaling-stroke;
    }
    .area {
      fill: var(--color-hero-line);
      opacity: 0.55;
    }
    .line {
      fill: none;
      stroke: var(--color-hero-accent);
      stroke-width: 3;
      stroke-linecap: round;
      vector-effect: non-scaling-stroke;
    }
    .line.over {
      stroke: var(--color-hero-bad);
      stroke-dasharray: 2 6;
    }
    .dot {
      position: absolute;
      width: 0.875rem;
      height: 0.875rem;
      border-radius: var(--radius-pill);
      transform: translate(-50%, -50%);
    }
    .dot.start {
      left: 0;
      background: var(--color-on-hero);
      box-shadow: 0 0 0 4px var(--color-hero);
    }
    .dot.end {
      left: 100%;
      background: var(--color-hero-accent);
      box-shadow: 0 0 0 4px var(--color-hero);
      border-radius: 0.2rem;
      transform: translate(-50%, -50%) rotate(45deg);
    }
    .dot.out {
      background: var(--color-hero-bad);
      box-shadow: 0 0 0 4px var(--color-hero);
      width: 0.75rem;
      height: 0.75rem;
    }
    .tick {
      position: absolute;
      bottom: -1.5rem;
      color: var(--color-on-hero-muted);
      font-size: var(--text-xs);
    }
    .tick.today {
      left: 0;
      transform: translateX(-0.4rem);
    }
    .tick.payday {
      right: 0;
      transform: translateX(0.4rem);
    }
  `,
})
export class Runway {
  readonly free = input.required<number>();
  readonly projected = input.required<number>();

  protected readonly shape = computed(() => runwayShape(this.free(), this.projected()));
}
