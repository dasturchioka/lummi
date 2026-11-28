import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Fills `{name}`-style placeholders in a dictionary string (shared with the Mini App). */
export { fill } from '@lummi/i18n';
