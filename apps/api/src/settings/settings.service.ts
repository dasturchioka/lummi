import {
  settingDefinitions,
  settingKeys,
  type SettingKey,
  type SettingValue,
} from '@lummi/contracts';
import { inArray, settings, type Db, type DbOrTx } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
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

export interface SettingRowState {
  key: SettingKey;
  value: unknown;
  updatedAt: Date | null;
  /** A stored value that no longer fits its schema; `value` is the default then. */
  invalid: boolean;
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

  /** Every registered setting with its effective value; a stale stored value is flagged, not thrown. */
  async listAll(): Promise<SettingRowState[]> {
    const rows = await this.db.select().from(settings);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return settingKeys.map((key) => {
      const def = settingDefinitions[key];
      const row = byKey.get(key);
      if (!row) return { key, value: def.default, updatedAt: null, invalid: false };
      const parsed = def.schema.safeParse(row.value);
      return parsed.success
        ? { key, value: parsed.data, updatedAt: row.updatedAt, invalid: false }
        : { key, value: def.default, updatedAt: row.updatedAt, invalid: true };
    });
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
      if (isDeepStrictEqual(old, parsed)) return; // nothing changed: no write, no audit noise
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
