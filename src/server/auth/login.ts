import 'server-only';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { getDb } from '../db/client';
import { loginCodes, users } from '../db/schema';
import { decryptSecret, encryptSecret, numericCode, safeEqual, sha256Hex } from '../security/crypto';
import { hashPassword, passwordProblems, verifyPassword } from '../security/password';
import { assertRateLimit } from '../security/rate-limit';
import { generateRecoveryCodes, generateTotpSecret, otpauthUri, verifyTotp } from '../security/totp';
import { forbidden, invalid } from '../errors';
import { auditEvent, writeAudit } from '../audit';
import { queueEmail } from '../email/send';
import { renderSimpleEmail } from '../email/simple';
import { kickJobs } from '../jobs/run';
import { env } from '../env';
import { revokeAllSessions } from './sessions';
import { afterResponse } from '../after-response';
import { PLATFORM_NAME } from '@/lib/branding';
import type { UserActor } from './actor';

/**
 * Signing in with an account (Media10 staff and suppliers): password or emailed code, then
 * two-factor. Ported from BluePrint. The emailed-code helpers are shared with the storefront's
 * exhibitor sign-in, kept apart by `scope`.
 */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_PASSWORD_FAILURES = 10;
export const PASSWORD_LOCK_MS = 15 * 60 * 1000;

export const GENERIC_CODE_ERROR = 'That code is wrong or has expired. Ask for a new one and try again.';
const GENERIC_PASSWORD_ERROR = 'That email and password do not match. After several wrong tries, password sign-in pauses for 15 minutes.';

export type RequestContext = { ip?: string | null; userAgent?: string | null };

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function codeHash(scope: string, email: string, code: string) {
  return sha256Hex(`${scope}:${email}:${code}`);
}

function userActor(user: typeof users.$inferSelect, ctx: RequestContext): UserActor {
  return { kind: 'user', userId: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin, readOnly: false, ip: ctx.ip, userAgent: ctx.userAgent };
}

export type CodeEmail = { heading: string; subject: (code: string) => string; footer: string; senderName?: string | null; brandColor?: string; showId?: string | null };

/** Makes a fresh six-digit code for an address in a scope and emails it. Older codes in that scope stop working. */
export async function issueEmailCode(email: string, scope: string, ctx: RequestContext, mail: CodeEmail) {
  const db = await getDb();
  const code = numericCode(6);
  await db.transaction(async (tx) => {
    await tx
      .update(loginCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(loginCodes.scope, scope), eq(loginCodes.email, email), isNull(loginCodes.consumedAt)));
    await tx.insert(loginCodes).values({ email, scope, codeHash: codeHash(scope, email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS), ip: ctx.ip ?? null });
    const { html, text } = renderSimpleEmail({
      heading: mail.heading,
      paragraphs: [`Your code is ${code}. It works once and expires in 10 minutes.`, 'If you did not ask for it, you can ignore this email. Nobody can sign in without the code.'],
      footer: mail.footer,
      brandColor: mail.brandColor,
    });
    await queueEmail({ to: email, showId: mail.showId ?? null, templateKey: 'sign_in_code', category: 'security', subject: mail.subject(code), html, text, senderName: mail.senderName }, { tx });
  });
  await kickJobs();
}

/** Checks and uses up an emailed code. Throws the same message whatever was wrong. */
export async function consumeEmailCode(email: string, scope: string, codeRaw: string, ctx: RequestContext) {
  const code = codeRaw.replace(/\s/g, '');
  await assertRateLimit(`code-verify:ip:${ctx.ip ?? 'unknown'}`, 200, 15 * 60);
  if (!/^\d{6}$/.test(code)) throw invalid(GENERIC_CODE_ERROR, { code: 'Enter the six-digit code from the email.' });
  const db = await getDb();
  const [row] = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.scope, scope), eq(loginCodes.email, email), isNull(loginCodes.consumedAt), gt(loginCodes.expiresAt, new Date())))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  // With no code waiting there is nothing to guess, so the address's own limits are not used up
  // (otherwise anyone could lock a person out by typing wrong codes for them).
  if (!row) throw invalid(GENERIC_CODE_ERROR);
  await assertRateLimit(`code-verify:email:${scope}:${email}`, 10, 15 * 60);
  await assertRateLimit(`code-verify:email-day:${scope}:${email}`, 100, 24 * 3600);
  // Count the attempt in one step, so guesses sent at the same moment cannot all see the same count.
  const [counted] = await db
    .update(loginCodes)
    .set({ attempts: sql`${loginCodes.attempts} + 1` })
    .where(and(eq(loginCodes.id, row.id), isNull(loginCodes.consumedAt), lt(loginCodes.attempts, MAX_CODE_ATTEMPTS)))
    .returning({ id: loginCodes.id });
  if (!counted) {
    await db.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, row.id));
    throw invalid(GENERIC_CODE_ERROR);
  }
  if (!safeEqual(row.codeHash, codeHash(scope, email, code))) {
    await auditEvent(null, { action: 'auth.code_failed', summary: 'A wrong sign-in code was entered', email, details: { scope } });
    throw invalid(GENERIC_CODE_ERROR);
  }
  // Use the code up; if the right code arrives twice at once, only one wins.
  const [used] = await db
    .update(loginCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(loginCodes.id, row.id), isNull(loginCodes.consumedAt)))
    .returning({ id: loginCodes.id });
  if (!used) throw invalid(GENERIC_CODE_ERROR);
}

export const STAFF_SCOPE = 'staff';

/**
 * Emails a sign-in code. Behaves the same whether or not the address has an account, so the form
 * cannot be used to find out who is registered.
 */
export async function requestSignInCode(emailRaw: string, ctx: RequestContext): Promise<void> {
  const email = normaliseEmail(emailRaw);
  if (!isValidEmail(email)) throw invalid('Enter a valid email address.', { email: 'Enter a valid email address.' });
  await assertRateLimit(`signin-code:email:${email}:ip:${ctx.ip ?? 'unknown'}`, 5, 15 * 60);
  await assertRateLimit(`signin-code:email-hour:${email}`, 30, 3600);
  await assertRateLimit(`signin-code:ip:${ctx.ip ?? 'unknown'}`, 100, 15 * 60);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const known = user && user.status === 'active' ? user : null;
  // The slow part happens after the reply either way, so timing reveals nothing.
  await afterResponse(async () => {
    if (!known) {
      await auditEvent(null, { action: 'auth.code_requested_no_account', summary: 'A sign-in code was asked for an address with no account', email });
      return;
    }
    await issueEmailCode(email, STAFF_SCOPE, ctx, {
      heading: `Your ${PLATFORM_NAME} sign-in code`,
      subject: (code) => `${code} is your ${PLATFORM_NAME} sign-in code`,
      footer: `${PLATFORM_NAME}, from Media10.`,
    });
    await auditEvent(userActor(known, ctx), { action: 'auth.code_requested', summary: 'Asked for a sign-in code', entityType: 'user', entityId: known.id });
  });
}

export async function verifySignInCode(emailRaw: string, codeRaw: string, ctx: RequestContext) {
  const email = normaliseEmail(emailRaw);
  await consumeEmailCode(email, STAFF_SCOPE, codeRaw, ctx);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.status !== 'active') throw invalid(GENERIC_CODE_ERROR);
  await auditEvent(userActor(user, ctx), { action: 'auth.sign_in', summary: 'Signed in with an emailed code', entityType: 'user', entityId: user.id });
  return user;
}

// A real argon2id hash of a random string, so unknown emails take as long as known ones.
let dummyHash: string | null = null;
async function getDummyHash() {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing-only');
  return dummyHash;
}

export async function signInWithPassword(emailRaw: string, password: string, ctx: RequestContext) {
  const email = normaliseEmail(emailRaw);
  await assertRateLimit(`signin-password:email:${email}`, 20, 15 * 60);
  await assertRateLimit(`signin-password:ip:${ctx.ip ?? 'unknown'}`, 50, 15 * 60);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.passwordHash || user.status !== 'active' || (user.lockedUntil && user.lockedUntil.getTime() > Date.now())) {
    // The same message and time as a wrong password, so nothing about the account is revealed.
    await verifyPassword(await getDummyHash(), password);
    throw invalid(GENERIC_PASSWORD_ERROR);
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failures = user.failedPasswordAttempts + 1;
    const lock = failures >= MAX_PASSWORD_FAILURES;
    await db
      .update(users)
      .set({ failedPasswordAttempts: lock ? 0 : failures, lockedUntil: lock ? new Date(Date.now() + PASSWORD_LOCK_MS) : user.lockedUntil })
      .where(eq(users.id, user.id));
    await auditEvent(userActor(user, ctx), {
      action: lock ? 'auth.password_locked' : 'auth.password_failed',
      summary: lock ? 'Password sign-in paused after too many wrong tries' : 'A wrong password was entered',
      entityType: 'user',
      entityId: user.id,
    });
    throw invalid(GENERIC_PASSWORD_ERROR);
  }
  await db.update(users).set({ failedPasswordAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
  await auditEvent(userActor(user, ctx), { action: 'auth.sign_in', summary: 'Signed in with a password', entityType: 'user', entityId: user.id });
  return user;
}

/** Password and two-factor changes need a sign-in from the last 15 minutes, so a borrowed session cannot make them. */
export const RECENT_SIGN_IN_MS = 15 * 60 * 1000;

function assertRecentSignIn(session: { createdAt: Date } | null | undefined, what: string) {
  if (!session || Date.now() - session.createdAt.getTime() > RECENT_SIGN_IN_MS) {
    throw invalid(`For your security, sign out and sign in again, then ${what} within 15 minutes.`);
  }
}

/** Tells the person about a change to how they sign in, in case it was not them. */
async function sendSecurityNotice(actor: UserActor, heading: string, what: string) {
  const { html, text } = renderSimpleEmail({
    heading,
    paragraphs: [what, 'If this was not you, sign in with an emailed code straight away and contact Media10.'],
    footer: `${PLATFORM_NAME}, from Media10.`,
  });
  await queueEmail({ to: actor.email, templateKey: 'security_notice', category: 'security', subject: heading, html, text });
  await kickJobs();
}

export async function setPassword(actor: UserActor, newPassword: string, currentSession?: { id: string; createdAt: Date } | null) {
  assertRecentSignIn(currentSession, 'change your password');
  const problem = passwordProblems(newPassword, actor.email);
  if (problem) throw invalid(problem, { password: problem });
  const db = await getDb();
  const [current] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, actor.userId)).limit(1);
  if (current?.passwordHash && (await verifyPassword(current.passwordHash, newPassword))) {
    throw invalid('Choose a new password, not the one you have now.', { password: 'Choose a different password.' });
  }
  const hash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: hash, mustChangePassword: false, failedPasswordAttempts: 0, lockedUntil: null }).where(eq(users.id, actor.userId));
    await writeAudit(tx, actor, { action: 'auth.password_set', summary: 'Set a new password', entityType: 'user', entityId: actor.userId });
  });
  // Changing a password signs out every other device.
  await revokeAllSessions(actor.userId, currentSession?.id);
  await sendSecurityNotice(actor, `Your ${PLATFORM_NAME} password was set`, 'A password was just set for your account, and your other devices were signed out.');
}

// ---------------------------------------------------------------------------
// Two-factor (authenticator apps + recovery codes)
// ---------------------------------------------------------------------------

export async function beginTotpEnrollment(actor: UserActor) {
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1);
  if (!user) throw invalid('We could not find your account.');
  if (user.totpEnabledAt) throw invalid('Two-factor sign-in is already set up.');
  // Reuse a set-up that was started but not finished, so the code already added to the app keeps working.
  let secret = user.totpSecretEnc ? decryptSecret(user.totpSecretEnc) : null;
  if (!secret) {
    secret = generateTotpSecret();
    await db.update(users).set({ totpSecretEnc: encryptSecret(secret), totpLastStep: null }).where(eq(users.id, user.id));
  }
  const uri = otpauthUri(secret, user.email);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return { secret, uri, qrDataUrl };
}

export async function confirmTotpEnrollment(actor: UserActor, code: string, currentSession?: { createdAt: Date } | null): Promise<string[]> {
  assertRecentSignIn(currentSession, 'turn on two-factor sign-in');
  await assertRateLimit(`totp-enrol:${actor.userId}`, 10, 15 * 60);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1);
  if (!user?.totpSecretEnc) throw invalid('Start the set-up again.');
  if (user.totpEnabledAt) throw invalid('Two-factor sign-in is already set up.');
  const step = verifyTotp(decryptSecret(user.totpSecretEnc), code, null);
  if (step === null) throw invalid('That code did not match. Check the time on your phone and try the newest code.', { code: 'That code did not match.' });
  const recovery = generateRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ totpEnabledAt: new Date(), totpLastStep: step, recoveryCodeHashes: recovery.map((c) => sha256Hex(c)) }).where(eq(users.id, user.id));
    await writeAudit(tx, actor, { action: 'auth.2fa_enabled', summary: 'Turned on two-factor sign-in', entityType: 'user', entityId: user.id });
  });
  await revokeAllSessions(user.id, actor.sessionId);
  await sendSecurityNotice(actor, 'Two-factor sign-in is on', 'Two-factor sign-in was just turned on for your account. Other devices were signed out.');
  return recovery;
}

/** Checks an authenticator or recovery code for the signed-in person. True when it matches. */
export async function verifySecondFactor(userId: string, codeRaw: string, ctx: RequestContext): Promise<boolean> {
  await assertRateLimit(`2fa:${userId}`, 10, 15 * 60);
  await assertRateLimit(`2fa-day:${userId}`, 40, 24 * 3600);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.totpSecretEnc || !user.totpEnabledAt) return false;
  const code = codeRaw.trim().toLowerCase();
  const actor = userActor(user, ctx);
  if (/^\d{6}$/.test(code.replace(/\s/g, ''))) {
    const step = verifyTotp(decryptSecret(user.totpSecretEnc), code, user.totpLastStep ?? null);
    if (step === null) {
      await auditEvent(actor, { action: 'auth.2fa_failed', summary: 'A wrong two-factor code was entered', entityType: 'user', entityId: user.id });
      return false;
    }
    await db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
    await auditEvent(actor, { action: 'auth.2fa_passed', summary: 'Passed two-factor sign-in', entityType: 'user', entityId: user.id });
    return true;
  }
  const hash = sha256Hex(code.replace(/\s/g, ''));
  if (user.recoveryCodeHashes.includes(hash)) {
    await db
      .update(users)
      .set({ recoveryCodeHashes: user.recoveryCodeHashes.filter((h) => h !== hash) })
      .where(eq(users.id, user.id));
    await auditEvent(actor, {
      action: 'auth.2fa_passed',
      summary: 'Passed two-factor sign-in with a recovery code',
      entityType: 'user',
      entityId: user.id,
      details: { method: 'recovery', remaining: user.recoveryCodeHashes.length - 1 },
    });
    return true;
  }
  await auditEvent(actor, { action: 'auth.2fa_failed', summary: 'A wrong two-factor code was entered', entityType: 'user', entityId: user.id });
  return false;
}

/** Super admins only: clears someone's two-factor set-up after checking who they are. */
export async function resetTwoFactor(actor: UserActor, userId: string) {
  if (!actor.isSuperAdmin || actor.readOnly) throw forbidden();
  if (userId === actor.userId) throw forbidden('Ask another super admin to reset your two-factor sign-in.');
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [] }).where(eq(users.id, userId));
    await writeAudit(tx, actor, { action: 'auth.2fa_reset', summary: 'Reset someone’s two-factor sign-in', entityType: 'user', entityId: userId });
  });
  await revokeAllSessions(userId);
}

export function appUrl(path = '/') {
  return new URL(path, env().APP_URL).toString();
}
