import type { CustomerDto, Theme } from '@lummi/contracts';
import { sharedMessages, type Language, type SharedMessages } from '@lummi/i18n';
import { miniappMessages, type MiniappMessages } from '@lummi/i18n/miniapp';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { api, unwrap } from './api';
import { paintTelegramChrome, telegramLanguage } from './telegram';

const HINT_KEY = 'lummi.prefs';

interface Hint {
  language?: Language;
  theme?: Theme;
}

/** A per-device convenience so the first paint is already in the right language and theme. The server decides. */
function readHint(): Hint {
  try {
    const h = JSON.parse(localStorage.getItem(HINT_KEY) ?? '{}') as Hint;
    return {
      language: h.language === 'ru' || h.language === 'uz' ? h.language : undefined,
      theme: h.theme === 'dark' || h.theme === 'light' ? h.theme : undefined,
    };
  } catch {
    return {};
  }
}
function writeHint(hint: Hint) {
  try {
    localStorage.setItem(HINT_KEY, JSON.stringify(hint));
  } catch {
    /* private mode */
  }
}

/** Set before React renders so a dark customer never sees a light flash. */
export function applyInitialTheme() {
  document.documentElement.dataset.theme = readHint().theme ?? 'light';
}

/**
 * Run a theme or language change inside a View Transition: the page cross-fades once (0.28 s,
 * index.css) instead of every surface snapping at the same instant. A fade is not movement, so
 * it stays under reduced motion. Without the API the change is simply applied.
 */
function crossFade(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition !== 'function') return update();
  try {
    doc.startViewTransition(() => flushSync(update));
  } catch {
    update();
  }
}

/** Shared strings plus this app's own; the bot's and admin's are never bundled here. */
export type Messages = SharedMessages & MiniappMessages;

interface PrefsValue {
  language: Language;
  theme: Theme;
  t: Messages;
  customer: CustomerDto | undefined;
  customerQuery: { isError: boolean; isPending: boolean; isFetching: boolean; refetch: () => void };
  setLanguage(language: Language): void;
  setTheme(theme: Theme): void;
}

const PrefsContext = createContext<PrefsValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [local, setLocal] = useState<Hint>(() => {
    const hint = readHint();
    return { language: hint.language ?? telegramLanguage(), theme: hint.theme ?? 'light' };
  });

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => unwrap(await api.me.get(), 200),
  });

  const save = useMutation({
    mutationFn: async (prefs: Hint) => unwrap(await api.me.updatePreferences({ body: prefs }), 200),
    onSuccess: (customer) => queryClient.setQueryData(['me'], customer),
    onError: () => void queryClient.invalidateQueries({ queryKey: ['me'] }), // revert to the saved value
  });

  // The server is the source of truth: adopt what it has saved for this customer.
  useEffect(() => {
    if (me.data && !save.isPending) setLocal({ language: me.data.language, theme: me.data.theme });
  }, [me.data, save.isPending]);

  const language = local.language ?? 'ru';
  const theme = local.theme ?? 'light';

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.lang = language;
    paintTelegramChrome();
    writeHint({ language, theme });
  }, [language, theme]);

  // Screenshots and tests wait for this: server prefs applied and fonts loaded.
  useEffect(() => {
    if (me.isPending) return;
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) document.documentElement.dataset.ready = '1';
    });
    return () => {
      live = false;
    };
  }, [me.isPending]);

  const setLanguage = useCallback(
    (next: Language) => {
      crossFade(() => setLocal((p) => ({ ...p, language: next })));
      save.mutate({ language: next });
    },
    [save],
  );
  const setTheme = useCallback(
    (next: Theme) => {
      crossFade(() => setLocal((p) => ({ ...p, theme: next })));
      save.mutate({ theme: next });
    },
    [save],
  );

  const value = useMemo<PrefsValue>(
    () => ({
      language,
      theme,
      t: { ...sharedMessages[language], ...miniappMessages[language] },
      customer: me.data,
      customerQuery: {
        isError: me.isError,
        isPending: me.isPending,
        isFetching: me.isFetching,
        refetch: () => void me.refetch(),
      },
      setLanguage,
      setTheme,
    }),
    [
      language,
      theme,
      me.data,
      me.isError,
      me.isPending,
      me.isFetching,
      me.refetch,
      setLanguage,
      setTheme,
    ],
  );
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsValue {
  const v = useContext(PrefsContext);
  if (!v) throw new Error('usePrefs outside PrefsProvider');
  return v;
}
