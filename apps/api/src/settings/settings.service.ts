import { settingDefinitions, type SettingKey, type SettingValue } from '@lummi/contracts';
import { inArray, settings, type Db, type DbOrTx } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService, type Actor } from '../audit/audit.service';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';

/** Reads several settings in one query; a missing row yields the default. Usable before the Nest container exists. */
export async function readSettings<K extends SettingKey>(
  db: DbOrTx,
  keys: readonly K[],
): Promise<{ [P in K]: SettingValue<P> }> {
  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, [...keys]));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const def = settingDefinitions[key];
    out[key] = byKey.has(key) ? def.schema.parse(byKey.get(key)) : def.default;
  }
  return out as { [P in K]: SettingValue<P> };
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EDGES) private readonly edges: Edges,
  ) {}

  /** Typed read; a missing row yields the default, a stored value that fails its schema throws. */
  async get<K extends SettingKey>(key: K, tx: DbOrTx = this.db): Promise<SettingValue<K>> {
    return (await readSettings(tx, [key]))[key];
  }

  /** The only way to change a setting: validates, writes, and audits old and new in one transaction (the caller's when `outer` is given). */
  async set<K extends SettingKey>(
    key: K,
    value: SettingValue<K>,
    actor: Actor,
    outer?: DbOrTx,
  ): Promise<void> {
    const parsed = settingDefinitions[key].schema.parse(value);
    const run = async (tx: DbOrTx) => {
      const old = await this.get(key, tx);
      await tx
        .insert(settings)
        .values({ key, value: parsed })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: parsed, updatedAt: this.edges.clock.now() },
        });
      await this.audit.record(tx, {
        actor,
        action: 'setting.changed',
        targetType: 'setting',
        targetId: key,
        payload: { old, new: parsed },
      });
    };
    // With the caller's transaction the change commits or rolls back with it.
    await (outer ? run(outer) : this.db.transaction(run));
  }
}
