import { settingDefinitions, type SettingKey, type SettingValue } from '@lummi/contracts';
import { eq, settings, type Db, type DbOrTx } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService, type Actor } from '../audit/audit.service';
import { DB } from '../tokens';

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Typed read; a missing row yields the default, a stored value that fails its schema throws. */
  async get<K extends SettingKey>(key: K, tx: DbOrTx = this.db): Promise<SettingValue<K>> {
    const def = settingDefinitions[key];
    const [row] = await tx.select().from(settings).where(eq(settings.key, key));
    if (!row) return def.default as SettingValue<K>;
    return def.schema.parse(row.value) as SettingValue<K>;
  }

  /** The only way to change a setting: validates, writes, and audits old and new in one transaction. */
  async set<K extends SettingKey>(key: K, value: SettingValue<K>, actor: Actor): Promise<void> {
    const parsed = settingDefinitions[key].schema.parse(value);
    await this.db.transaction(async (tx) => {
      const old = await this.get(key, tx);
      await tx
        .insert(settings)
        .values({ key, value: parsed })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: parsed, updatedAt: new Date() },
        });
      await this.audit.record(tx, {
        actor,
        action: 'setting.changed',
        targetType: 'setting',
        targetId: key,
        payload: { old, new: parsed },
      });
    });
  }
}
