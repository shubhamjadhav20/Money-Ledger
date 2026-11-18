import { describe, expect, it } from 'vitest';
import { askHidden } from './prompt.ts';
import type { PromptInput } from './prompt.ts';

/** A stand-in terminal: records what is written and lets the test "type". */
function fakeTerminal(isTTY = true) {
  let listener: ((chunk: string) => void) | undefined;
  const written: string[] = [];
  const modes: boolean[] = [];
  const input: PromptInput = {
    isTTY,
    setRawMode: (mode) => modes.push(mode),
    setEncoding: () => undefined,
    resume: () => undefined,
    pause: () => undefined,
    on: (_event, l) => {
      listener = l;
    },
    off: () => {
      listener = undefined;
    },
  };
  return {
    input,
    output: { write: (text: string) => written.push(text) },
    type: (text: string) => listener?.(text),
    isListening: () => listener !== undefined,
    written,
    modes,
  };
}

describe('askHidden()', () => {
  it('collects typed text without ever echoing it', async () => {
    const t = fakeTerminal();
    const answer = askHidden('Password: ', t.input, t.output);
    t.type('s3');
    t.type('cr');
    t.type('et\r');
    expect(await answer).toBe('s3cret');
    expect(t.written.join('')).toBe('Password: \n');
    expect(t.written.join('')).not.toMatch(/s3|cr|et|\*/u);
  });

  it('handles a whole password pasted at once, and backspace', async () => {
    const t = fakeTerminal();
    const answer = askHidden('?', t.input, t.output);
    t.type('abcd\u007f\u007fxy\n');
    expect(await answer).toBe('abxy');
  });

  it('switches the terminal back to normal and stops listening, however it ends', async () => {
    const done = fakeTerminal();
    const first = askHidden('?', done.input, done.output);
    done.type('x\r');
    await first;
    expect(done.modes).toEqual([true, false]);
    expect(done.isListening()).toBe(false);

    const cancelled = fakeTerminal();
    const second = askHidden('?', cancelled.input, cancelled.output);
    cancelled.type('abc\u0003');
    await expect(second).rejects.toThrow(/cancel/i);
    expect(cancelled.modes).toEqual([true, false]);
    expect(cancelled.isListening()).toBe(false);
  });

  it('refuses when there is no interactive terminal, instead of reading a password from a pipe', async () => {
    const t = fakeTerminal(false);
    await expect(askHidden('?', t.input, t.output)).rejects.toThrow(/terminal/i);
    expect(t.modes).toEqual([]);
  });
});
