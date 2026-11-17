/** Helpers for specs only (excluded from the app build). Missing things fail loudly, with a name. */

export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to exist`);
  return value;
}

export function query(root: ParentNode, selector: string): HTMLElement {
  return must(root.querySelector<HTMLElement>(selector), `an element matching ${selector}`);
}
