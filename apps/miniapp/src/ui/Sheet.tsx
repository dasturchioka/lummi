import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { CloseIcon } from './icons';

/** Bottom sheet on Radix Dialog: focus trap, Escape, scroll lock and aria come from the primitive. */
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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=closed]:animate-[fade-out_0.2s_ease-in_forwards] data-[state=open]:animate-[fade-in_0.2s_ease-out]" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-[520px] flex-col rounded-t-card bg-ground text-ink outline-none data-[state=closed]:animate-[sheet-out_0.22s_cubic-bezier(0.4,0,1,1)_forwards] data-[state=open]:animate-[sheet-in_0.32s_cubic-bezier(0.16,1,0.3,1)]">
          <div className="mx-auto mt-2 h-1 w-9 rounded-pill bg-line-strong" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
            <Dialog.Title className="type-section">{title}</Dialog.Title>
            <Dialog.Close
              aria-label={closeLabel}
              className="grid size-8 place-items-center rounded-pill text-ink"
            >
              <CloseIcon size={20} />
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="type-small px-4 pb-2 text-muted">
              {description}
            </Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(16px,var(--safe-b,0px))]">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
