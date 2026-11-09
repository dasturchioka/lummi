import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { showBackButton } from '../lib/back-button';
import { CloseIcon } from './icons';

/**
 * Bottom sheet on Radix Dialog: focus trap, Escape, scroll lock and aria come from the primitive.
 * It rises on the iOS drawer curve (0.32 s) and leaves faster on the same curve (0.2 s), over a 0.2 s dim.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  closeLabel: string;
  children: ReactNode;
}) {
  // Telegram's back button (and Android's system back) closes an open sheet, not the screen or the app.
  const change = useRef(onOpenChange);
  useLayoutEffect(() => {
    change.current = onOpenChange;
  });
  useEffect(() => (open ? showBackButton(true, () => change.current(false)) : undefined), [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=closed]:animate-[fade-out_0.2s_ease-out_forwards] data-[state=open]:animate-[fade-in_0.2s_ease-out]" />
        <Dialog.Content
          // Focus the sheet itself, not its first control: a ring on the X after a tap is noise.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
          }}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[min(85dvh,calc(var(--tg-viewport-stable-height,100dvh)-48px))] w-full max-w-[520px] flex-col overscroll-contain rounded-t-card bg-ground text-ink outline-none data-[state=closed]:animate-[sheet-out_0.2s_cubic-bezier(0.32,0.72,0,1)_forwards] data-[state=open]:animate-[sheet-in_0.32s_cubic-bezier(0.32,0.72,0,1)]"
        >
          <div
            className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-pill bg-line-strong"
            aria-hidden="true"
          />
          <div className="flex shrink-0 items-start justify-between gap-3 pt-2 pr-2 pl-4">
            <Dialog.Title className="type-section min-w-0 pt-3 pb-2">{title}</Dialog.Title>
            <Dialog.Close
              aria-label={closeLabel}
              className="grid size-11 shrink-0 place-items-center rounded-pill text-ink transition-[background-color,transform] duration-150 hover:bg-field active:scale-95 active:bg-field"
            >
              <CloseIcon size={20} />
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="type-small shrink-0 px-4 pb-3 text-muted">
              {description}
            </Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(16px,var(--safe-b,0px))]">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
