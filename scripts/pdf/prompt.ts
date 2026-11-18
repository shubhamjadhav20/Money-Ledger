/**
 * Asks for a secret in the terminal without showing it: raw mode, nothing echoed, not kept in
 * history or in a process argument list. Streams are injectable so the behaviour can be tested.
 */

export interface PromptInput {
  readonly isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: 'utf8'): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: 'data', listener: (chunk: string) => void): unknown;
  off(event: 'data', listener: (chunk: string) => void): unknown;
}

export interface PromptOutput {
  write(text: string): unknown;
}

const CTRL_C = '\u0003';
const BACKSPACE = ['\u007f', '\b'];

export function askHidden(
  question: string,
  input: PromptInput = process.stdin,
  output: PromptOutput = process.stderr,
): Promise<string> {
  if (input.isTTY !== true || input.setRawMode === undefined) {
    return Promise.reject(
      new Error(
        'A password can only be typed in an interactive terminal (nothing is read from pipes).',
      ),
    );
  }
  output.write(question);
  input.setRawMode(true);
  input.setEncoding('utf8');
  input.resume();

  return new Promise((resolve, reject) => {
    let typed = '';
    const finish = (): void => {
      input.off('data', onData);
      input.setRawMode?.(false);
      input.pause();
      output.write('\n');
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(typed);
          return;
        }
        if (ch === CTRL_C) {
          finish();
          reject(new Error('Cancelled.'));
          return;
        }
        typed = BACKSPACE.includes(ch) ? typed.slice(0, -1) : typed + ch;
      }
    };
    input.on('data', onData);
  });
}
