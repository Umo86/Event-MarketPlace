/**
 * Who a request acts for. Every service function takes an Actor explicitly, so permission checks
 * never depend on hidden global state and are easy to test.
 *
 * - `user`: someone with an account (Media10 staff, suppliers).
 * - `exhibitor`: someone signed in to one show's storefront (DECISIONS.md: they have no account).
 * - `system`: scheduled jobs and webhooks acting for the platform.
 */
export type UserActor = {
  kind: 'user';
  userId: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  /** True while viewing as someone else (phase 4): every change is refused. */
  readOnly: boolean;
  sessionId?: string;
  ip?: string | null;
  userAgent?: string | null;
};

export type ExhibitorActor = {
  kind: 'exhibitor';
  showId: string;
  email: string;
  sessionId?: string;
  ip?: string | null;
  userAgent?: string | null;
};

export type SystemActor = {
  kind: 'system';
  /** What is acting: "cron", "stripe webhook", "BluePrint import". */
  label: string;
  /** Another system calling our API with a key (BluePrint sending the exhibitor list). */
  api?: boolean;
  ip?: string | null;
  userAgent?: string | null;
};

export type Actor = UserActor | ExhibitorActor | SystemActor;

export function systemActor(label: string, ctx: { ip?: string | null; userAgent?: string | null; api?: boolean } = {}): SystemActor {
  return { kind: 'system', label, api: ctx.api ?? false, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null };
}

/** For logs and the audit trail. */
export function actorEmail(actor: Actor): string | null {
  return actor.kind === 'system' ? null : actor.email;
}
