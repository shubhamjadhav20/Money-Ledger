import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** Colour tokens declared inside the block that starts with `selector {`. */
function colours(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No block for ${selector}`);
  const end = css.indexOf('}', start);
  const body = css.slice(start, end);
  return declarations(body);
}

/** `--color-NAME: #rrggbb;` declarations in a piece of CSS, keyed by NAME. */
function declarations(cssText: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, value] of cssText.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6});/gu)) {
    if (name !== undefined && value !== undefined) found[name] = value;
  }
  return found;
}

const themes = {
  dark: colours(':root'),
  light: colours(":root[data-theme='light']"),
};
const SURFACES = ['bg', 'surface-1', 'surface-2'] as const;
const TEXT_ON_SURFACE = [
  'text',
  'text-muted',
  'accent',
  'positive',
  'negative',
  'warning',
] as const;

function token(theme: 'dark' | 'light', name: string): string {
  const value = themes[theme][name];
  if (value === undefined) throw new Error(`Missing --color-${name} in ${theme}`);
  return value;
}

describe.each(['dark', 'light'] as const)('design tokens (%s)', (theme) => {
  it.each(SURFACES.flatMap((s) => TEXT_ON_SURFACE.map((t) => [t, s] as const)))(
    '%s text on %s meets WCAG AA (4.5:1)',
    (text, surface) => {
      expect(contrast(token(theme, text), token(theme, surface))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(SURFACES)('control borders on %s meet 3:1', (surface) => {
    expect(contrast(token(theme, 'border-strong'), token(theme, surface))).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('text on the accent fill meets AA', () => {
    expect(contrast(token(theme, 'on-accent'), token(theme, 'accent-fill'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each(['on-hero', 'on-hero-muted', 'hero-accent', 'hero-good', 'hero-bad'])(
    '%s text on the hero block meets AA',
    (name) => {
      expect(contrast(token(theme, name), token(theme, 'hero'))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('the focus ring is visible (3:1) on every surface', () => {
    for (const surface of SURFACES) {
      expect(contrast(token(theme, 'focus'), token(theme, surface))).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('light theme declarations', () => {
  it('the prefers-color-scheme block and the explicit data-theme block never drift apart', () => {
    const marker = '@media (prefers-color-scheme: light)';
    const start = css.indexOf(marker);
    const end = css.indexOf(":root[data-theme='light']", start);
    const media = css.slice(start, end);
    expect(declarations(media)).toEqual(themes.light);
  });

  it('declares the same colour tokens as dark, so no component falls back to the wrong theme', () => {
    expect(Object.keys(themes.light).sort()).toEqual(Object.keys(themes.dark).sort());
  });
});
