import {
  CROSS_RULE_KEYS,
  crossSettingIssues,
  settingDefinitions,
  settingKeys,
  type SettingIssue,
  type SettingKey,
  type SettingValue,
} from '@lummi/contracts';
import { eq, inArray, settings, type Db, type DbOrTx } from '@lummi/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { AuditService, type Actor } from '../audit/audit.service';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';

const log = new Logger('Settings');
const warned = new Set<string>();

/**
 * Reads several settings in one query; a missing row, or a stored value the registry no longer
 * accepts, yields the default (the second case is logged once per key), so one stale row never
 * breaks a customer-facing read. Usable before the Nest container exists.
 */
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
    if (!byKey.has(key)) {
      out[key] = def.default;
      continue;
    }
    const parsed = def.schema.safeParse(byKey.get(key));
    if (parsed.success) out[key] = parsed.data;
    else {
      if (!warned.has(key)) {
        warned.add(key);
        log.warn(`stored value of setting ${key} no longer fits the registry; using the default`);
      }
      out[key] = def.default;
    }
  }
  return out as { [P in K]: SettingValue<P> };
}

/** A value that fits its own schema but breaks a rule between settings (`crossSettingIssues`). */
export class SettingRefusedError extends Error {
  constructor(readonly issues: SettingIssue[]) {
    super(`setting refused: ${issues.map((i) => i.code).join(', ')}`);
  }
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

  /** Typed read; a missing row or a stale stored value yields the default. */
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

  /** One setting's state for the admin page. */
  async state(key: SettingKey): Promise<SettingRowState> {
    return (await this.listAll()).find((s) => s.key === key) as SettingRowState;
  }

  /**
   * The only way to change a setting: validates (its schema, then the rules between settings,
   * `SettingRefusedError`), writes, and audits old and new in one transaction (the caller's when
   * `outer` is given).
   */
  async set<K extends SettingKey>(
    key: K,
    value: SettingValue<K>,
    actor: Actor,
    outer?: DbOrTx,
  ): Promise<void> {
    const parsed = settingDefinitions[key].schema.parse(value);
    const run = async (tx: DbOrTx) => {
      // The raw stored value, locked: a stale value can still be replaced, and two concurrent
      // saves can't both log the same old value.
      const [row] = await tx.select().from(settings).where(eq(settings.key, key)).for('update');
      const old = row ? row.value : settingDefinitions[key].default;
      if (isDeepStrictEqual(old, parsed)) return; // nothing changed: no write, no audit noise
      if ((CROSS_RULE_KEYS as readonly SettingKey[]).includes(key)) {
        const issues = crossSettingIssues(key, parsed, await readSettings(tx, CROSS_RULE_KEYS));
        if (issues.length > 0) throw new SettingRefusedError(issues);
      }
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
