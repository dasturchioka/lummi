import { z } from 'zod';

/** A Telegram username with `@`: 5 to 32 characters after it, letters, digits, underscore; starts with a letter, no trailing underscore. */
export const telegramUsernameSchema = z
  .string()
  .regex(/^@[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/, 'Telegram username, like @lummi_manager');
