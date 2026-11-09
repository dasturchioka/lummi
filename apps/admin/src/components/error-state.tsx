'use client';

import { dictionaries } from '@lummi/i18n';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { languageFromDocument } from '@/lib/lang-cookie';

/**
 * Error pattern for error.tsx boundaries: what failed, what to do, and «Повторить», which
 * refetches the server data and re-renders the segment. Boundaries get no server props, so the
 * language comes from the cookie.
 */
export function ErrorState({ reset, icon }: { reset: () => void; icon?: React.ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lang, setLang] = useState<'ru' | 'uz'>('ru');
  useEffect(() => setLang(languageFromDocument()), []);
  const t = dictionaries[lang].admin;
  return (
    <EmptyState
      tone="error"
      title={t.errors.loadTitle}
      action={
        <Button
          variant="outline"
          loading={pending}
          onClick={() =>
            start(() => {
              router.refresh();
              reset();
            })
          }
        >
          {icon}
          {t.actions.retry}
        </Button>
      }
    >
      {t.errors.loadText}
    </EmptyState>
  );
}
