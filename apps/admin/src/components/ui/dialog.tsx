'use client';

import * as AlertPrimitive from '@radix-ui/react-alert-dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * Dialogs: a bottom sheet on phones (thumb reach, safe area), a centred 440 px dialog from
 * 640 px up. `AlertDialog*` is the same surface for confirmations: no dismiss on outside click,
 * focus starts on Cancel.
 */
const overlayClass = 'motion-overlay fixed inset-0 z-50 bg-graphite/40';
const contentClass = cn(
  'motion-dialog fixed z-50 flex max-h-[90dvh] flex-col overflow-y-auto overscroll-contain bg-card text-foreground outline-none',
  'inset-x-0 bottom-0 rounded-t-card px-5 pt-6 pb-[max(20px,env(safe-area-inset-bottom))]',
  'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(440px,calc(100vw-32px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:p-6',
);

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content className={cn(contentClass, className)} {...props}>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

const titleClass = 'text-base font-semibold leading-snug text-balance [overflow-wrap:anywhere]';
const descriptionClass =
  'mt-1.5 text-sm text-muted-foreground text-pretty [overflow-wrap:anywhere]';

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn(titleClass, className)} {...props} />;
}
export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn(descriptionClass, className)} {...props} />;
}

/** Actions: stacked full width on phones (primary on top), right-aligned from 640 px. */
export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>button]:max-sm:w-full',
        className,
      )}
      {...props}
    />
  );
}

export const AlertDialog = AlertPrimitive.Root;
export const AlertDialogCancel = AlertPrimitive.Cancel;

export function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AlertPrimitive.Content>) {
  return (
    <AlertPrimitive.Portal>
      <AlertPrimitive.Overlay className={overlayClass} />
      <AlertPrimitive.Content className={cn(contentClass, className)} {...props}>
        {children}
      </AlertPrimitive.Content>
    </AlertPrimitive.Portal>
  );
}
export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertPrimitive.Title>) {
  return <AlertPrimitive.Title className={cn(titleClass, className)} {...props} />;
}
export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertPrimitive.Description>) {
  return <AlertPrimitive.Description className={cn(descriptionClass, className)} {...props} />;
}
