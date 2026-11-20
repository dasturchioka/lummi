'use client';

import { RotateCw } from 'lucide-react';
import { ErrorState } from '@/components/error-state';

/** A screen that failed to load keeps the shell; «Повторить» re-renders it. */
export default function PanelError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState reset={reset} icon={<RotateCw strokeWidth={1.5} aria-hidden />} />;
}
