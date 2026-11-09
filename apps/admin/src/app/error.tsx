'use client';

import { RotateCw } from 'lucide-react';
import { ErrorState } from '@/components/error-state';

/** The API is unreachable before the shell renders (sign-in check): a centred retry. */
export default function RootError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center px-4 py-10">
      <ErrorState reset={reset} icon={<RotateCw strokeWidth={1.5} aria-hidden />} />
    </main>
  );
}
