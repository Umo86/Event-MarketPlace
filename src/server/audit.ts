import 'server-only';
import { getDb, type DbLike } from './db/client';
import { auditLog } from './db/schema';
import type { Actor } from './auth/actor';

export type AuditEntry = {
  /** Dotted name: "show.branding_updated", "exhibitors.imported", "auth.sign_in". */
  action: string;
  /** One plain sentence for people reading the log. */
  summary: string;
  entityType?: string;
  entityId?: string | null;
  showId?: string | null;
  supplierId?: string | null;
  details?: Record<string, unknown>;
};

/** Values never written to the audit log, even if a caller passes them by mistake. */
const SENSITIVE_KEYS = /password|token|secret|code|hash|card|iban|sort_?code|account_?number|key$/i;

export function scrub(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (SENSITIVE_KEYS.test(k)) out[k] = '[redacted]';
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = scrub(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

function row(actor: Actor | null, entry: AuditEntry) {
  return {
    actorType: actor ? (actor.kind === 'system' ? (actor.api ? ('api' as const) : ('system' as const)) : actor.kind) : ('anonymous' as const),
    actorUserId: actor?.kind === 'user' ? actor.userId : null,
    actorEmail: actor && actor.kind !== 'system' ? actor.email : actor?.label ?? null,
    action: entry.action,
    summary: entry.summary.slice(0, 500),
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    showId: entry.showId ?? (actor?.kind === 'exhibitor' ? actor.showId : null),
    supplierId: entry.supplierId ?? null,
    ip: actor?.ip ?? null,
    userAgent: actor?.userAgent?.slice(0, 300) ?? null,
    details: scrub(entry.details ?? {}),
  };
}

/**
 * Records a change in the same transaction as the change itself: if the change is saved, so is
 * the record of who made it, and if this fails the change is rolled back.
 */
export async function writeAudit(tx: DbLike, actor: Actor | null, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values(row(actor, entry));
}

/**
 * Security events with no change to roll back (a failed sign-in, a code requested). Never throws:
 * recording the attempt must not break the response to it.
 */
export async function auditEvent(actor: Actor | null, entry: AuditEntry & { email?: string | null }): Promise<void> {
  try {
    const db = await getDb();
    const values = row(actor, entry);
    if (!actor && entry.email) values.actorEmail = entry.email;
    await db.insert(auditLog).values(values);
  } catch (err) {
    console.error('Audit log write failed', entry.action, err instanceof Error ? err.message : err);
  }
}
