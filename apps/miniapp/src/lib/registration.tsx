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
import { askContact, askWriteAccess } from './telegram';

// The sheet (and Radix Dialog behind it) loads only when an action first needs a phone.
const RegistrationSheet = lazy(() => import('../ui/RegistrationSheet'));

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
  const [status, setStatus] = useState<RegistrationStatus>('idle');
  const waiter = useRef<((r: RegistrationResult) => void) | null>(null);

  const finish = useCallback((r: RegistrationResult) => {
    setOpen(false);
    setStatus('idle');
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
    return new Promise<RegistrationResult>((resolve) => {
      waiter.current = resolve;
      setStatus('idle');
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
    // Same step: let the bot write. Refusing never blocks ordering; it is only recorded.
    const allowed = await askWriteAccess();
    if (allowed !== null) {
      const saved = await api.me.writeAccess({ body: { allowed } }).catch(() => null);
      if (saved?.status === 200) queryClient.setQueryData<CustomerDto>(['me'], saved.body);
    }
    finish('ready');
  }, [finish, queryClient]);

  const value = useMemo(() => ({ ensurePhone }), [ensurePhone]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {open ? (
        <Suspense fallback={null}>
          <RegistrationSheet
            open
            status={status}
            onShare={() => void share()}
            onClose={() => finish('cancelled')}
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
