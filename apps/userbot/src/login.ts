import { stat } from 'node:fs/promises';
import { sealSession, SessionFileError, writeSessionFile } from './session-crypto';

/**
 * Logging the userbot into a personal account, once, on the server (ADR 0014): phone, the code
 * Telegram sends, then the 2FA password. The session string goes straight from mtcute into the
 * sealed file: it is never printed, logged or put in an error.
 */

export interface LoginStartParams {
  phone: () => Promise<string>;
  code: () => Promise<string>;
  password: () => Promise<string>;
  codeSentCallback?: (code: { type: string }) => void;
  invalidCodeCallback?: (type: 'code' | 'password') => void | Promise<void>;
}

/** The part of mtcute's `TelegramClient` the login uses (the real one satisfies it). */
export interface LoginClient {
  start(params: LoginStartParams): Promise<{ id: number; isBot: boolean }>;
  exportSession(): Promise<string>;
  logOut(): Promise<unknown>;
  /** Close the connections; the session stays valid. */
  destroy(): Promise<void>;
}

export interface Prompt {
  ask(question: string): Promise<string>;
  /** Not echoed (the 2FA password). */
  askHidden(question: string): Promise<string>;
  say(line: string): void;
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

export async function login(o: {
  client: LoginClient;
  prompt: Prompt;
  sessionFile: string;
  key: Buffer;
  force: boolean;
}): Promise<void> {
  const { client, prompt } = o;
  const replacing = await exists(o.sessionFile);
  if (replacing && !o.force) {
    throw new SessionFileError(
      `a session already exists at ${o.sessionFile}; run again with --force to replace it`,
    );
  }

  try {
    const me = await client.start({
      phone: () => prompt.ask('Phone number of the account, with country code (+998…): '),
      code: () => prompt.ask('Login code Telegram sent: '),
      password: () => prompt.askHidden('Two-step verification password (not shown): '),
      codeSentCallback: (code) => prompt.say(`Telegram sent the login code (${code.type}).`),
      invalidCodeCallback: (type) => prompt.say(`That ${type} was not accepted; try again.`),
    });
    if (me.isBot) {
      await client.logOut();
      throw new SessionFileError('this is a bot account; the userbot needs a personal account');
    }
    await writeSessionFile(o.sessionFile, sealSession(await client.exportSession(), o.key));
    prompt.say(`Logged in as user ${me.id}. The session is sealed in ${o.sessionFile}.`);
    prompt.say(
      'It shows as "LUMMI userbot" under Settings > Devices of that account; ending it there stops the userbot.',
    );
    if (replacing) {
      prompt.say(
        'The session it replaces is still active: end the older "LUMMI userbot" under Settings > Devices.',
      );
    }
  } finally {
    await client.destroy();
  }
}
