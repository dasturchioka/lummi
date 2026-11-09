import type { StaffDto } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';

export const toStaffDto = (s: StaffRow): StaffDto => ({
  id: s.id,
  telegramId: s.telegramId,
  name: s.name,
  role: s.role,
  active: s.active,
});
