import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import type { Prompt } from '../login';

/** A stream that drops what is written: readline's echo goes here for the hidden question. */
const discard = () =>
  new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });

/**
 * Questions on the terminal, one readline interface per question, never with a history.
 * `askHidden` gives readline a discarding output, so what is typed (the 2FA password) is not echoed.
 */
export function terminalPrompt(): Prompt & { close(): void } {
  async function question(text: string, hidden: boolean): Promise<string> {
    if (hidden) process.stdout.write(text);
    const rl = createInterface({
      input: process.stdin,
      output: hidden ? discard() : process.stdout,
      terminal: process.stdin.isTTY === true,
      historySize: 0,
    });
    try {
      return await rl.question(hidden ? '' : text);
    } finally {
      rl.close();
      if (hidden) process.stdout.write('\n');
    }
  }
  return {
    ask: (text) => question(text, false),
    askHidden: (text) => question(text, true),
    say: (line) => void process.stdout.write(`${line}\n`),
    close: () => process.stdin.pause(),
  };
}
