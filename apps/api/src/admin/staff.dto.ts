import type { StaffDto } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';

/** Never the hash: only whether a password is set (ADR 0038). */
export const toStaffDto = (s: StaffRow): StaffDto => ({
  id: s.id,
  telegramId: s.telegramId,
  login: s.login,
  hasPassword: s.passwordHash !== null,
  mustChangePassword: s.mustChangePassword,
  name: s.name,
  photo: s.photoHash,
  role: s.role,
  active: s.active,
});
