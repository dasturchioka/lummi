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

/** What the login needs from mtcute (`loginClient()` in mtcute-client.ts builds it). */
export interface LoginClient {
  start(params: LoginStartParams): Promise<{ id: number; isBot: boolean }>;
  exportSession(): Promise<string>;
  /** account.getPassword → hasPassword: whether the account has a two-step verification password. */
  hasTwoStepPassword(): Promise<boolean>;
  /** End this session on Telegram's side. */
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

  let loggedIn = false;
  try {
    const me = await client.start({
      phone: () => prompt.ask('Phone number of the account, with country code (+998…): '),
      code: () => prompt.ask('Login code Telegram sent: '),
      password: () => prompt.askHidden('Two-step verification password (not shown): '),
      codeSentCallback: (code) => prompt.say(`Telegram sent the login code (${code.type}).`),
      invalidCodeCallback: (type) => prompt.say(`That ${type} was not accepted; try again.`),
    });
    loggedIn = true;
    if (me.isBot) {
      throw new SessionFileError('this is a bot account; the userbot needs a personal account');
    }
    // The session is full access to the account; without a 2FA password, whoever gets the SIM or
    // the SMS code gets the account too.
    if (!(await client.hasTwoStepPassword())) {
      throw new SessionFileError(
        'this account has no two-step password: turn on Two-Step Verification (Settings > Privacy and Security), then log in again',
      );
    }
    await writeSessionFile(o.sessionFile, sealSession(await client.exportSession(), o.key));
    loggedIn = false; // saved: the session must stay valid
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
    // Not saved (refused, or the file could not be written): end the new session, so no live
    // session is left that nobody holds.
    if (loggedIn) await client.logOut().catch(() => undefined);
    await client.destroy().catch(() => undefined);
  }
}
