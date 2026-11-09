import 'server-only';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb, type DbLike } from '../db/client';
import { invitations, SHOW_PERMISSIONS, SHOW_ROLES, showStaff, shows, users, type InvitationKind, type ShowPermission, type ShowRole } from '../db/schema';
import { randomToken, sha256Hex } from '../security/crypto';
import { assertRateLimit } from '../security/rate-limit';
import { hashPassword, passwordProblems } from '../security/password';
import { forbidden, invalid, notFound } from '../errors';
import { writeAudit } from '../audit';
import { queueEmail } from '../email/send';
import { renderSimpleEmail } from '../email/simple';
import { kickJobs } from '../jobs/run';
import { authorize } from '../authz';
import { consumeEmailCode, isValidEmail, issueEmailCode, normaliseEmail, appUrl, type RequestContext } from './login';
import { PLATFORM_NAME } from '@/lib/branding';
import type { Actor, UserActor } from './actor';

/**
 * Invitations to an account: super admins and show teams (suppliers from phase 1). Ported from
 * BluePrint. Accepting one always needs an emailed code unless the person is already signed in as
 * that address: links can be forwarded.
 */
export const INVITE_TTL_MS = 14 * 24 * 3600 * 1000;
const inviteScope = (invitationId: string) => `invite:${invitationId}`;

export type CreateInvitationInput = {
  kind: InvitationKind;
  email: string;
  showId?: string | null;
  role?: string | null;
  permissions?: string[];
};

async function check(actor: Actor, input: CreateInvitationInput) {
  switch (input.kind) {
    case 'super_admin':
      await authorize(actor, 'platform.admins.manage', {}, { write: true });
      return;
    case 'show_staff':
      if (!input.showId) throw invalid('Choose a show.');
      await authorize(actor, 'show.team.manage', { showId: input.showId }, { write: true });
      if (!SHOW_ROLES.includes(input.role as ShowRole)) throw invalid('Choose a role.', { role: 'Choose a role.' });
      return;
    case 'supplier':
      throw invalid('Supplier invitations arrive in the next part of the build.');
  }
}

async function describe(inv: typeof invitations.$inferSelect, tx?: DbLike) {
  const db = tx ?? (await getDb());
  const [show] = inv.showId ? await db.select({ name: shows.name }).from(shows).where(eq(shows.id, inv.showId)).limit(1) : [];
  const headline =
    inv.kind === 'super_admin'
      ? `You've been made a super admin on ${PLATFORM_NAME}`
      : inv.kind === 'show_staff'
        ? `Join the ${show?.name ?? 'show'} team on ${PLATFORM_NAME}`
        : `You've been invited to ${PLATFORM_NAME}`;
  return { headline, showName: show?.name ?? null };
}

export async function createInvitation(actor: UserActor, input: CreateInvitationInput) {
  const email = normaliseEmail(input.email);
  if (!isValidEmail(email)) throw invalid('Enter a valid email address.', { email: 'Enter a valid email address.' });
  await check(actor, input);
  await assertRateLimit(`invite:${actor.userId}`, 300, 3600);
  const permissions = input.kind === 'show_staff' ? (input.permissions ?? []).filter((p): p is ShowPermission => SHOW_PERMISSIONS.includes(p as ShowPermission)) : [];

  const db = await getDb();
  const token = randomToken(32);
  const url = appUrl(`/invite/${token}`);
  const inv = await db.transaction(async (tx) => {
    // Replace any earlier pending invitation for the same person and place.
    const same = [eq(invitations.email, email), eq(invitations.kind, input.kind), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)];
    if (input.showId) same.push(eq(invitations.showId, input.showId));
    await tx.update(invitations).set({ revokedAt: new Date() }).where(and(...same));
    const [row] = await tx
      .insert(invitations)
      .values({
        tokenHash: sha256Hex(token),
        email,
        kind: input.kind,
        showId: input.showId ?? null,
        role: input.role ?? null,
        permissions,
        invitedBy: actor.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        lastSentAt: new Date(),
      })
      .returning();
    const d = await describe(row, tx);
    const { html, text } = renderSimpleEmail({
      heading: d.headline,
      paragraphs: [
        `${actor.name || 'Someone at Media10'} has invited you to ${PLATFORM_NAME}, where exhibitors order stand services from approved suppliers.`,
        'Use the button below to accept. The link is personal to you and works for 14 days.',
      ],
      button: { label: 'Accept invitation', url },
      footer: `This invitation was sent to ${email}. If you weren't expecting it, you can ignore this email.`,
    });
    await queueEmail({ to: email, showId: input.showId ?? null, templateKey: 'invite_staff', category: 'transactional', subject: d.headline, html, text }, { tx });
    await writeAudit(tx, actor, {
      action: 'invitation.created',
      summary: `Invited ${email}${input.kind === 'super_admin' ? ' as a super admin' : input.role === 'show_admin' ? ' as a show admin' : ' to the show team'}`,
      entityType: 'invitation',
      entityId: row.id,
      showId: input.showId ?? null,
      details: { kind: input.kind, email, role: input.role ?? null, permissions },
    });
    return row;
  });
  await kickJobs();
  return { invitation: inv, url };
}

export async function revokeInvitation(actor: UserActor, invitationId: string) {
  const db = await getDb();
  const [inv] = await db.select().from(invitations).where(eq(invitations.id, invitationId)).limit(1);
  if (!inv) throw notFound();
  if (inv.kind === 'super_admin') await authorize(actor, 'platform.admins.manage', {}, { write: true });
  else if (inv.showId) await authorize(actor, 'show.team.manage', { showId: inv.showId }, { write: true });
  else throw notFound();
  await db.transaction(async (tx) => {
    await tx.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, invitationId));
    await writeAudit(tx, actor, { action: 'invitation.revoked', summary: `Cancelled the invitation to ${inv.email}`, entityType: 'invitation', entityId: inv.id, showId: inv.showId });
  });
}

/** A usable invitation from the token in its link, or null. */
export async function findInvitation(token: string, opts: { signedInEmail?: string | null } = {}) {
  if (!token || token.length < 20 || token.length > 100) return null;
  const db = await getDb();
  const [inv] = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.tokenHash, sha256Hex(token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
    .limit(1);
  if (!inv) return null;
  const [existing] = await db.select({ id: users.id, name: users.name, hasPassword: users.passwordHash }).from(users).where(eq(users.email, inv.email)).limit(1);
  const needsEmailCode = !(opts.signedInEmail && normaliseEmail(opts.signedInEmail) === inv.email);
  return {
    invitation: inv,
    needsEmailCode,
    existingUser: existing ? { id: existing.id, name: existing.name, hasPassword: Boolean(existing.hasPassword) } : null,
    ...(await describe(inv)),
  };
}

export async function sendInvitationCode(token: string, ctx: RequestContext) {
  const found = await findInvitation(token);
  if (!found) throw notFound('This invitation has expired or has already been used.');
  await assertRateLimit(`invite-code:${found.invitation.id}`, 5, 15 * 60);
  await issueEmailCode(found.invitation.email, inviteScope(found.invitation.id), ctx, {
    heading: `Confirm your email for ${PLATFORM_NAME}`,
    subject: (code) => `${code} is your ${PLATFORM_NAME} confirmation code`,
    footer: 'Enter it on the invitation page to finish setting up your account.',
  });
}

/**
 * Accepts an invitation: creates or activates the account, grants what it describes and uses the
 * invitation up. Returns the user to sign in.
 */
export async function acceptInvitation(token: string, input: { name: string; code?: string; password?: string }, ctx: RequestContext, opts: { signedInEmail?: string | null } = {}) {
  const found = await findInvitation(token, opts);
  if (!found) throw notFound('This invitation has expired or has already been used.');
  const inv = found.invitation;
  const name = input.name.trim().slice(0, 120);
  if (!name && !found.existingUser?.name) throw invalid('Enter your name.', { name: 'Enter your name.' });
  const password = input.password?.trim() ? input.password : null;
  if (password) {
    const problem = passwordProblems(password, inv.email);
    if (problem) throw invalid(problem, { password: problem });
  }
  if (found.needsEmailCode) {
    if (!input.code) throw invalid('Enter the code we emailed you.', { code: 'Enter the code we emailed you.' });
    await consumeEmailCode(inv.email, inviteScope(inv.id), input.code, ctx);
  }
  const passwordHash = password ? await hashPassword(password) : null;

  const db = await getDb();
  return db.transaction(async (tx) => {
    // Use the invitation up first; if two requests race, only one wins.
    const claimed = await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning({ id: invitations.id });
    if (!claimed.length) throw notFound('This invitation has already been used.');
    let [u] = await tx.select().from(users).where(eq(users.email, inv.email)).limit(1);
    if (!u) {
      [u] = await tx.insert(users).values({ email: inv.email, name, status: 'active', passwordHash }).returning();
    } else {
      if (u.status === 'disabled') throw forbidden('This account has been switched off. Contact Media10.');
      [u] = await tx
        .update(users)
        .set({ status: 'active', name: u.name || name, ...(passwordHash && !u.passwordHash ? { passwordHash } : {}) })
        .where(eq(users.id, u.id))
        .returning();
    }
    if (inv.kind === 'super_admin') {
      await tx.update(users).set({ isSuperAdmin: true }).where(eq(users.id, u.id));
    } else if (inv.kind === 'show_staff' && inv.showId) {
      const role = inv.role as ShowRole;
      const permissions = inv.permissions as ShowPermission[];
      await tx
        .insert(showStaff)
        .values({ showId: inv.showId, userId: u.id, role, permissions, addedBy: inv.invitedBy })
        .onConflictDoUpdate({ target: [showStaff.showId, showStaff.userId], set: { role, permissions } });
    }
    await tx.update(invitations).set({ acceptedUserId: u.id }).where(eq(invitations.id, inv.id));
    const actor: UserActor = { kind: 'user', userId: u.id, email: u.email, name: u.name, isSuperAdmin: u.isSuperAdmin, readOnly: false, ip: ctx.ip, userAgent: ctx.userAgent };
    await writeAudit(tx, actor, { action: 'invitation.accepted', summary: 'Accepted an invitation', entityType: 'invitation', entityId: inv.id, showId: inv.showId, details: { kind: inv.kind } });
    return u;
  });
}
