import 'server-only';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { getDb } from '../db/client';
import { exhibitorContacts, exhibitorSessions, halls, shows, standTypes, stands, usedSignInTokens } from '../db/schema';
import { invalid } from '../errors';
import { auditEvent } from '../audit';
import { assertRateLimit } from '../security/rate-limit';
import { decryptSecret, randomToken, sha256Hex } from '../security/crypto';
import { readToken, tokenKeyId, type TokenProblem } from '../security/connection-key';
import { consumeEmailCode, GENERIC_CODE_ERROR, isValidEmail, issueEmailCode, normaliseEmail, type RequestContext } from '../auth/login';
import { afterResponse } from '../after-response';
import { brandingFor, type ShowRow } from './shows';
import type { ExhibitorActor } from '../auth/actor';

/**
 * Exhibitors signing in to one show's storefront (DECISIONS.md, "Signing in"). Only an email on
 * that show's exhibitor list gets in, and nothing ever says whether an email is on the list.
 */

export const EXHIBITOR_SESSION_DAYS = 30;
export const EXHIBITOR_IDLE_DAYS = 7;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export const showScope = (showId: string) => `show:${showId}`;

/** Shows exhibitors can sign in to: open for ordering or closed (to see past orders), never drafts. */
export function storefrontOpenForSignIn(show: Pick<ShowRow, 'status'>) {
  return show.status === 'live' || show.status === 'closed';
}

/** Whether an email is an active contact on an active stand at the show. */
export async function onList(showId: string, email: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: exhibitorContacts.id })
    .from(exhibitorContacts)
    .innerJoin(stands, eq(stands.id, exhibitorContacts.standId))
    .where(and(eq(exhibitorContacts.showId, showId), eq(exhibitorContacts.email, email), eq(exhibitorContacts.status, 'active'), eq(stands.status, 'active')))
    .limit(1);
  return Boolean(row);
}

/**
 * Emails a code if the address is on the show's list. Behaves exactly the same either way: the same
 * reply, after the same work, with the slow part done after the response.
 */
export async function requestExhibitorCode(show: ShowRow, emailRaw: string, ctx: RequestContext) {
  const email = normaliseEmail(emailRaw);
  if (!isValidEmail(email)) throw invalid('Enter a valid email address.', { email: 'Enter a valid email address.' });
  await assertRateLimit(`ex-code:email:${show.id}:${email}`, 5, 15 * 60);
  await assertRateLimit(`ex-code:email-hour:${email}`, 30, 3600);
  await assertRateLimit(`ex-code:ip:${ctx.ip ?? 'unknown'}`, 100, 15 * 60);
  if (!storefrontOpenForSignIn(show)) return;
  await afterResponse(async () => {
    if (!(await onList(show.id, email))) {
      await auditEvent(null, { action: 'storefront.code_not_on_list', summary: 'A sign-in code was asked for an email not on the exhibitor list', email, showId: show.id });
      return;
    }
    const brand = await brandingFor(show);
    await issueEmailCode(email, showScope(show.id), ctx, {
      heading: `Your sign-in code for ${brand.marketplaceName}`,
      subject: (code) => `${code} is your ${brand.marketplaceName} sign-in code`,
      footer: `${brand.marketplaceName}: order services for your stand at ${show.name}.`,
      senderName: brand.emailSenderName,
      brandColor: brand.primaryColor,
      showId: show.id,
    });
    await auditEvent(null, { action: 'storefront.code_requested', summary: 'Asked for a storefront sign-in code', email, showId: show.id });
  });
}

async function createExhibitorSession(showId: string, email: string, method: 'code' | 'link', ctx: RequestContext) {
  const db = await getDb();
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + EXHIBITOR_SESSION_DAYS * 86_400_000);
  await db.insert(exhibitorSessions).values({ id: sha256Hex(token), showId, email, method, expiresAt, ip: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 300) ?? null });
  return { token, expiresAt };
}

/** Checks a code and starts a storefront session. */
export async function verifyExhibitorCode(show: ShowRow, emailRaw: string, code: string, ctx: RequestContext) {
  const email = normaliseEmail(emailRaw);
  if (!isValidEmail(email)) throw invalid(GENERIC_CODE_ERROR);
  await consumeEmailCode(email, showScope(show.id), code, ctx);
  // Taken off the list since the code was sent: the code alone isn't enough.
  if (!storefrontOpenForSignIn(show) || !(await onList(show.id, email))) throw invalid(GENERIC_CODE_ERROR);
  await auditEvent({ kind: 'exhibitor', showId: show.id, email, ip: ctx.ip, userAgent: ctx.userAgent }, { action: 'storefront.sign_in', summary: 'Signed in to the storefront with an emailed code', showId: show.id });
  return createExhibitorSession(show.id, email, 'code', ctx);
}

export type LinkSignIn = { ok: true; token: string; expiresAt: Date } | { ok: false; reason: TokenProblem };

/**
 * Signs in with a link from BluePrint or Billie. The token must be signed with this show's key,
 * still in date, not used before, and for an email on this show's list.
 */
export async function signInWithLink(show: ShowRow, token: string, ctx: RequestContext): Promise<LinkSignIn> {
  await assertRateLimit(`ex-link:ip:${ctx.ip ?? 'unknown'}`, 60, 15 * 60);
  const fail = async (reason: TokenProblem): Promise<LinkSignIn> => {
    await auditEvent(null, { action: 'storefront.link_refused', summary: `A sign-in link was refused (${reason.replace('_', ' ')})`, showId: show.id, details: { reason } });
    return { ok: false, reason };
  };
  if (!storefrontOpenForSignIn(show)) return fail('unknown_key');
  const keyId = tokenKeyId(token);
  if (!keyId) return fail('malformed');
  // A token for another show's key never signs anyone in here.
  if (!show.connectionKeyId || !show.connectionSigningKeyEnc || keyId !== show.connectionKeyId) return fail('unknown_key');
  const read = readToken(token, decryptSecret(show.connectionSigningKeyEnc));
  if (!read.ok) return fail(read.reason);
  const db = await getDb();
  // Each link works once: the first to record its id wins.
  const recorded = await db
    .insert(usedSignInTokens)
    .values({ showId: show.id, jti: read.jti, expiresAt: new Date(read.exp * 1000 + 120_000) })
    .onConflictDoNothing()
    .returning({ jti: usedSignInTokens.jti });
  if (!recorded.length) return fail('used');
  if (!(await onList(show.id, read.email))) return fail('not_listed');
  await db.update(shows).set({ lastLinkSignInAt: new Date() }).where(eq(shows.id, show.id));
  await auditEvent(
    { kind: 'exhibitor', showId: show.id, email: read.email, ip: ctx.ip, userAgent: ctx.userAgent },
    { action: 'storefront.sign_in', summary: `Signed in to the storefront from ${read.issuer === 'billie' ? 'Billie' : 'BluePrint'}`, showId: show.id },
  );
  const session = await createExhibitorSession(show.id, read.email, 'link', ctx);
  return { ok: true, ...session };
}

/**
 * The exhibitor behind a storefront cookie, or null. Only valid for its own show, and only while the
 * email is still on that show's list.
 */
export async function validateExhibitorSession(token: string | undefined | null, showId: string, ctx: RequestContext = {}): Promise<ExhibitorActor | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const db = await getDb();
  const id = sha256Hex(token);
  const [s] = await db.select().from(exhibitorSessions).where(eq(exhibitorSessions.id, id)).limit(1);
  if (!s || s.showId !== showId || s.revokedAt) return null;
  const now = Date.now();
  if (s.expiresAt.getTime() <= now || s.lastSeenAt.getTime() + EXHIBITOR_IDLE_DAYS * 86_400_000 <= now) return null;
  if (!(await onList(showId, s.email))) return null;
  if (now - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) await db.update(exhibitorSessions).set({ lastSeenAt: new Date(now) }).where(eq(exhibitorSessions.id, id));
  return { kind: 'exhibitor', showId, email: s.email, sessionId: id, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null };
}

export async function endExhibitorSession(sessionId: string) {
  const db = await getDb();
  await db.update(exhibitorSessions).set({ revokedAt: new Date() }).where(and(eq(exhibitorSessions.id, sessionId), isNull(exhibitorSessions.revokedAt)));
}

/** The stands an exhibitor can order for at this show (an email can be on several). */
export async function myStands(actor: ExhibitorActor) {
  const db = await getDb();
  return db
    .select({ standId: stands.id, number: stands.number, company: stands.companyName, hall: halls.name, standType: standTypes.name, standTypeId: stands.standTypeId, contactName: exhibitorContacts.name })
    .from(exhibitorContacts)
    .innerJoin(stands, eq(stands.id, exhibitorContacts.standId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .leftJoin(standTypes, eq(standTypes.id, stands.standTypeId))
    .where(and(eq(exhibitorContacts.showId, actor.showId), eq(exhibitorContacts.email, actor.email), eq(exhibitorContacts.status, 'active'), eq(stands.status, 'active')))
    .orderBy(stands.number);
}

/** Housekeeping: old sessions and used link ids. */
export async function purgeStorefrontSessions(now = new Date()) {
  const db = await getDb();
  await db.delete(exhibitorSessions).where(lt(exhibitorSessions.expiresAt, new Date(now.getTime() - 7 * 86_400_000)));
  await db.delete(usedSignInTokens).where(lt(usedSignInTokens.expiresAt, now));
}

