import { auditLog, type ActorType, type DbOrTx } from '@lummi/db';
import { Injectable } from '@nestjs/common';

export interface Actor {
  type: ActorType;
  /** Customer or staff id; null for ai/system. */
  id?: number | null;
}

export interface AuditEntry {
  actor: Actor;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  payload?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  /** Pass the transaction handle so the entry commits or rolls back with the change it describes. */
  async record(tx: DbOrTx, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLog).values({
      actorType: entry.actor.type,
      actorId: entry.actor.id ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId == null ? null : String(entry.targetId),
      payload: entry.payload ?? {},
    });
  }
}
