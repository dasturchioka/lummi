import {
  adminContract,
  settingDefinitions,
  toSettingIssues,
  type SettingKey,
  type SettingState,
} from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SettingsService, type SettingRowState } from '../settings/settings.service';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';

const toDto = (s: SettingRowState): SettingState => ({
  key: s.key,
  value: s.value,
  updatedAt: s.updatedAt?.toISOString() ?? null,
  invalid: s.invalid,
});

/** Owner-only: every rule value is edited here, validated against the registry (the client's check is a courtesy). */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @TsRestHandler(adminContract.settings.list)
  list() {
    return tsRestHandler(adminContract.settings.list, async () => ({
      status: 200 as const,
      body: (await this.settings.listAll()).map(toDto),
    }));
  }

  @TsRestHandler(adminContract.settings.update)
  update(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.settings.update, async ({ params, body }) => {
      if (!Object.hasOwn(settingDefinitions, params.key)) {
        return { status: 404 as const, body: { code: 'not_found' as const } };
      }
      const key = params.key as SettingKey;
      const parsed = settingDefinitions[key].schema.safeParse(body.value);
      if (!parsed.success) {
        return {
          status: 400 as const,
          body: { code: 'invalid_value' as const, issues: toSettingIssues(parsed.error) },
        };
      }
      await this.settings.set(key, parsed.data as never, { type: 'staff', id: actor.id });
      const state = (await this.settings.listAll()).find((s) => s.key === key) as SettingRowState;
      return { status: 200 as const, body: toDto(state) };
    });
  }
}
