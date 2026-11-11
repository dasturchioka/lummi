import { createInterface } from 'node:readline/promises';
import type { Prompt } from '../login';

/** Questions on the terminal; `askHidden` does not echo what is typed (the 2FA password). */
export function terminalPrompt(): Prompt & { close(): void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // readline has no public "mute": its internal writer is wrapped so typed characters are not echoed.
  const internal = rl as unknown as { _writeToOutput(s: string): void };
  const write = internal._writeToOutput.bind(rl);
  let muted = false;
  internal._writeToOutput = (s: string) => {
    if (!muted) write(s);
  };
  return {
    ask: (question) => rl.question(question),
    async askHidden(question) {
      process.stdout.write(question);
      muted = true;
      try {
        return await rl.question('');
      } finally {
        muted = false;
        process.stdout.write('\n');
      }
    },
    say: (line) => void process.stdout.write(`${line}\n`),
    close: () => rl.close(),
  };
}
