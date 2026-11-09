import {
  bindViewportCssVars,
  closeMiniApp,
  expandViewport,
  isAccessDeniedError,
  init,
  isTMA,
  miniAppReady,
  mockTelegramEnv,
  mountMiniAppSync,
  mountViewport,
  retrieveLaunchParams,
  requestContactComplete,
  requestWriteAccess,
  retrieveRawInitData,
  setMiniAppBackgroundColor,
  setMiniAppBottomBarColor,
  setMiniAppHeaderColor,
} from '@telegram-apps/sdk-react';
import { languageFromTelegram, type Language } from '@lummi/i18n';

const BROWSER_MODE = import.meta.env.DEV || import.meta.env.VITE_BROWSER_MODE === '1';

/**
 * Plain browsers (development, screenshots) have no Telegram. With launch params in the URL
 * hash (`#tgWebAppData=<signed initData>`) the SDK's mock environment stands in for the client.
 * The API still verifies the signature, so this is no way around sign-in.
 */
async function ensureEnvironment(): Promise<void> {
  const real = await isTMA('complete').catch(() => false);
  if (real || !BROWSER_MODE) return;
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has('tgWebAppData')) return;
  if (!params.has('tgWebAppVersion')) params.set('tgWebAppVersion', '8.0');
  if (!params.has('tgWebAppPlatform')) params.set('tgWebAppPlatform', 'tdesktop');
  if (!params.has('tgWebAppThemeParams')) params.set('tgWebAppThemeParams', '{}');
  console.info('[lummi] browser mode: Telegram is mocked'); // also the marker the dist check greps for
  mockTelegramEnv({ launchParams: params });
}

/** Every Telegram call is best-effort: a missing feature must never keep the shop from opening. */
async function safely(fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch {
    /* unsupported in this client */
  }
}

export async function bootTelegram(): Promise<void> {
  await ensureEnvironment();
  await safely(() => init());
  await safely(() => mountMiniAppSync.isAvailable() && mountMiniAppSync());
  // The viewport answers over the bridge; never hold the first paint for it.
  void safely(async () => {
    if (mountViewport.isAvailable()) await mountViewport();
    if (bindViewportCssVars.isAvailable()) bindViewportCssVars();
    if (expandViewport.isAvailable()) expandViewport();
  });
}

export function telegramReady(): void {
  void safely(() => miniAppReady.isAvailable() && miniAppReady());
}

/** Close the Mini App (the session-reopen state's «Закрыть»). */
export function closeApp(): void {
  void safely(() => closeMiniApp.isAvailable() && closeMiniApp());
}

export function rawInitData(): string | null {
  try {
    return retrieveRawInitData() ?? null;
  } catch {
    return null;
  }
}

export function launchStartParam(): string | null {
  try {
    return retrieveLaunchParams().tgWebAppStartParam ?? null;
  } catch {
    return null;
  }
}

/** First-open language guess, before the server answers: `uz` -> UZ, anything else RU. */
export function telegramLanguage(): Language {
  try {
    const user = new URLSearchParams(rawInitData() ?? '').get('user');
    const code = user ? (JSON.parse(user) as { language_code?: string }).language_code : undefined;
    return languageFromTelegram(code);
  } catch {
    return languageFromTelegram(undefined);
  }
}

/** Any CSS colour (hex, rgb(), named) -> `#rrggbb`, or null when it is not an opaque colour. */
export function toHex(css: string): `#${string}` | null {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return /^#[0-9a-f]{6}$/i.test(css) ? (css as `#${string}`) : null;
  probe.fillStyle = '#000000';
  probe.fillStyle = css; // an invalid value leaves the previous one
  const resolved = probe.fillStyle; // `#rrggbb` when opaque, `rgba(...)` otherwise
  return /^#[0-9a-f]{6}$/i.test(resolved) ? (resolved as `#${string}`) : null;
}

/** Telegram draws the header: paint it, and the background, in OUR active theme. */
export function paintTelegramChrome(): void {
  const token = getComputedStyle(document.documentElement).getPropertyValue('--c-ground').trim();
  const color = toHex(token);
  if (!color) return;
  void safely(() => setMiniAppHeaderColor.isAvailable() && setMiniAppHeaderColor(color));
  void safely(() => setMiniAppBackgroundColor.isAvailable() && setMiniAppBackgroundColor(color));
  void safely(() => setMiniAppBottomBarColor.isAvailable() && setMiniAppBottomBarColor(color));
}

export type ContactAnswer =
  { ok: true; proof: string } | { ok: false; reason: 'denied' | 'unsupported' | 'failed' };

/**
 * Ask Telegram for the user's contact. `proof` is the raw signed string
 * (`contact=...&auth_date=...&hash=...`); only the server can tell whether it is genuine.
 */
export async function askContact(): Promise<ContactAnswer> {
  if (!requestContactComplete.isAvailable()) return { ok: false, reason: 'unsupported' };
  try {
    const { raw } = await requestContactComplete();
    return { ok: true, proof: raw };
  } catch (e) {
    return { ok: false, reason: isAccessDeniedError(e) ? 'denied' : 'failed' };
  }
}

/** true = allowed, false = refused, null = could not ask (old client). Never throws. */
export async function askWriteAccess(): Promise<boolean | null> {
  if (!requestWriteAccess.isAvailable()) return null;
  try {
    return (await requestWriteAccess()) === 'allowed';
  } catch {
    return null;
  }
}
