import type { CustomerDto } from '@lummi/contracts';
import type { CustomerRow } from '@lummi/db';
import type { SettingsService } from '../settings/settings.service';

/** Public settings that ride on the customer (see customerSchema.config). */
export async function toCustomerDto(
  c: CustomerRow,
  settings: SettingsService,
): Promise<CustomerDto> {
  return {
    id: c.id,
    telegramId: c.telegramId,
    firstName: c.firstName,
    lastName: c.lastName,
    username: c.username,
    language: c.language,
    theme: c.theme,
    phone: c.phone,
    writeAccess: c.writeAccess,
    photo: c.photoKey,
    telegramPhoto: c.telegramPhotoUrl !== null,
    config: { managerUsername: await settings.get('shop.managerUsername') },
  };
}
