import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CustomerDto } from '@lummi/contracts';
import type { RegistrationStatus } from '../ui/RegistrationSheet';
import { api, session, unwrap } from './api';
import { askContact, askWriteAccess, openManagerChat } from './telegram';

// The sheet (and Radix Dialog behind it) loads only when an action first needs a phone.
const RegistrationSheet = lazy(() => import('../ui/RegistrationSheet'));

/**
 * How long the sheet shows «Номер сохранён» before it closes and the caller carries on: long
 * enough to read the number and where statuses will arrive.
 */
const DONE_BEAT_MS = 2600;

/** `ready`: the account has a verified phone. `cancelled`: the customer closed the sheet. */
export type RegistrationResult = 'ready' | 'cancelled';

interface RegistrationApi {
  /**
   * Make sure the signed-in customer has an account phone. Resolves at once when they do,
   * otherwise opens the registration sheet and resolves when it ends. Checkout calls this
   * before creating an order: `if ((await ensurePhone()) !== 'ready') return;`.
   */
  ensurePhone(): Promise<RegistrationResult>;
}

const Ctx = createContext<RegistrationApi | null>(null);

export function RegistrationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // Once loaded, the sheet stays mounted so closing plays its exit instead of vanishing.
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<RegistrationStatus>('idle');
  const [phone, setPhone] = useState<string | null>(null);
  const [botWrites, setBotWrites] = useState<boolean | null>(null);
  const waiter = useRef<((r: RegistrationResult) => void) | null>(null);
  const beat = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const finish = useCallback((r: RegistrationResult) => {
    clearTimeout(beat.current);
    setOpen(false); // the status stays as it was while the sheet slides away
    waiter.current?.(r);
    waiter.current = null;
  }, []);

  const ensurePhone = useCallback(async (): Promise<RegistrationResult> => {
    const me = await queryClient.fetchQuery({
      queryKey: ['me'],
      queryFn: async () => unwrap(await api.me.get(), 200),
      staleTime: 5_000,
    });
    if (me.phone) return 'ready';
    waiter.current?.('cancelled'); // a second caller replaces the first
    clearTimeout(beat.current);
    return new Promise<RegistrationResult>((resolve) => {
      waiter.current = resolve;
      setStatus('idle');
      setPhone(null);
      setBotWrites(null);
      setLoaded(true);
      setOpen(true);
    });
  }, [queryClient]);

  const share = useCallback(async () => {
    setStatus('busy');
    const answer = await askContact();
    if (!answer.ok) return setStatus(answer.reason);
    let res;
    try {
      res = await api.me.shareContact({ body: { proof: answer.proof } });
    } catch {
      return setStatus('failed');
    }
    if (res.status === 403) return setStatus('foreign');
    if (res.status === 409) return setStatus('taken');
    if (res.status === 400 && res.body.code === 'expired_contact') return setStatus('expired');
    if (res.status !== 200) return setStatus('failed');
    // A phone that belonged to an older account relinks it: carry on with that account's session.
    if (res.body.session) {
      session.adopt(res.body.session.token, Date.parse(res.body.session.expiresAt));
      await queryClient.invalidateQueries();
    }
    queryClient.setQueryData<CustomerDto>(['me'], res.body.customer);
    setPhone(res.body.customer.phone);
    // Same step: let the bot write. Refusing never blocks ordering; it is only recorded.
    const allowed = await askWriteAccess();
    if (allowed !== null) {
      const saved = await api.me.writeAccess({ body: { allowed } }).catch(() => null);
      if (saved?.status === 200) queryClient.setQueryData<CustomerDto>(['me'], saved.body);
    }
    // A short beat of «Номер сохранён» (and where statuses will arrive), then the caller goes on.
    setBotWrites(allowed);
    setStatus('done');
    beat.current = setTimeout(() => finish('ready'), DONE_BEAT_MS);
  }, [finish, queryClient]);

  const value = useMemo(() => ({ ensurePhone }), [ensurePhone]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {loaded ? (
        <Suspense fallback={null}>
          <RegistrationSheet
            open={open}
            status={status}
            phone={phone}
            botWrites={botWrites}
            onShare={() => void share()}
            // Closing over «Номер сохранён» only skips the beat: the phone is already saved.
            onClose={() => finish(status === 'done' ? 'ready' : 'cancelled')}
            onWriteManager={openManagerChat}
          />
        </Suspense>
      ) : null}
    </Ctx.Provider>
  );
}

export function useRegistration(): RegistrationApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRegistration outside RegistrationProvider');
  return v;
}
