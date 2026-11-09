import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { env } from '../env';
import { localPath } from '@/lib/safe-redirect';
import { AppError } from '../errors';
import { audienceOf, authorize, type ActionName, type Grant, type Target } from '../authz';
import { getShow } from '../services/shows';
import { validateExhibitorSession } from '../services/storefront-auth';
import type { ExhibitorActor, UserActor } from './actor';
import { createSession, isStaffUser, revokeSession, twoFactorSteps, validateSessionToken, type SessionRow, type SessionUser } from './sessions';
import type { RequestContext } from './login';

/**
 * Who is making this request, from their cookies. Two kinds of sign-in, kept apart
 * (DECISIONS.md): an account session for staff and suppliers, and a storefront session that
 * belongs to one show, whose cookie only ever goes to that show's own address.
 */

const secure = () => env().NODE_ENV === 'production';
const accountCookie = () => (secure() ? '__Host-em_session' : 'em_session');
const storefrontCookie = () => (secure() ? '__Secure-em_storefront' : 'em_storefront');

export async function requestContext(): Promise<RequestContext> {
  const h = await headers();
  const ip = h.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || h.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  return { ip, userAgent: h.get('user-agent') };
}

// ---------------------------------------------------------------------------
// Account sessions
// ---------------------------------------------------------------------------

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(accountCookie(), token, { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', expires: expiresAt });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(accountCookie(), '', { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', maxAge: 0 });
}

export type CurrentAuth = {
  session: SessionRow;
  user: SessionUser;
  actor: UserActor;
  isStaff: boolean;
  needsTwoFactorSetup: boolean;
  needsSecondFactor: boolean;
  /** Someone else chose their password (a new supplier login): they choose their own before anything else. */
  needsPasswordChange: boolean;
};

/** The signed-in account for this request (worked out once per request). */
export const getCurrentAuth = cache(async (): Promise<CurrentAuth | null> => {
  const store = await cookies();
  const valid = await validateSessionToken(store.get(accountCookie())?.value);
  if (!valid) return null;
  const { session, user } = valid;
  const ctx = await requestContext();
  const isStaff = await isStaffUser(user.id);
  const steps = twoFactorSteps({ isStaff, totpEnabledAt: user.totpEnabledAt, twoFactorVerified: session.twoFactorVerified });
  const actor: UserActor = {
    kind: 'user',
    userId: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin,
    readOnly: false,
    sessionId: session.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
  return { session, user, actor, isStaff, ...steps, needsPasswordChange: user.mustChangePassword };
});

/** Whether two-factor was turned on in the last few minutes (while the person saves their recovery codes). */
export function twoFactorJustTurnedOn(user: { totpEnabledAt: Date | null }) {
  return Boolean(user.totpEnabledAt && Date.now() - user.totpEnabledAt.getTime() < 10 * 60 * 1000);
}

/** Swaps this browser's session for a brand-new one (e.g. once two-factor is passed), so an earlier token is worthless. */
export async function renewSession(auth: CurrentAuth, opts: { twoFactorVerified: boolean }) {
  const { token, expiresAt } = await createSession(auth.user.id, { ...(await requestContext()), twoFactorVerified: opts.twoFactorVerified, signedInAt: auth.session.createdAt });
  await revokeSession(auth.session.id);
  await setSessionCookie(token, expiresAt);
}

/** Only paths on this site, so the sign-in page cannot be used to send people elsewhere. */
export function safeNextPath(next: string | null | undefined, fallback = '/start'): string {
  const path = localPath(next);
  if (!path || path === '/' || path.startsWith('/?') || path.startsWith('/#')) return fallback;
  return path;
}

async function currentPath() {
  return safeNextPath((await headers()).get('x-pathname'));
}

/** The signed-in account, sending the person to sign in or finish two-factor when needed. No permission check. */
export async function requireSignedIn(opts: { allowIncompleteTwoFactor?: boolean } = {}): Promise<UserActor> {
  const auth = await getCurrentAuth();
  if (!auth) redirect(`/sign-in?next=${encodeURIComponent(await currentPath())}`);
  if (!opts.allowIncompleteTwoFactor) {
    if (auth.needsSecondFactor) redirect(`/two-factor?next=${encodeURIComponent(await currentPath())}`);
    if (auth.needsPasswordChange) redirect(`/choose-password?next=${encodeURIComponent(await currentPath())}`);
    if (auth.needsTwoFactorSetup) redirect('/two-factor-setup');
  }
  return auth.actor;
}

/** For route handlers: null instead of a redirect. */
export async function getUserActorForApi(): Promise<UserActor | null> {
  const auth = await getCurrentAuth();
  if (!auth || auth.needsTwoFactorSetup || auth.needsSecondFactor || auth.needsPasswordChange) return null;
  return auth.actor;
}

export async function signOutCurrentSession() {
  const auth = await getCurrentAuth();
  if (auth) await revokeSession(auth.session.id);
  await clearSessionCookie();
}

// ---------------------------------------------------------------------------
// Storefront sessions
// ---------------------------------------------------------------------------

export async function setStorefrontCookie(slug: string, token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(storefrontCookie(), token, { httpOnly: true, secure: secure(), sameSite: 'lax', path: `/${slug}`, expires: expiresAt });
}

export async function clearStorefrontCookie(slug: string) {
  const store = await cookies();
  store.set(storefrontCookie(), '', { httpOnly: true, secure: secure(), sameSite: 'lax', path: `/${slug}`, maxAge: 0 });
}

/** The exhibitor signed in to this show's storefront, or null. */
export const getExhibitor = cache(async (showId: string): Promise<ExhibitorActor | null> => {
  const store = await cookies();
  return validateExhibitorSession(store.get(storefrontCookie())?.value, showId, await requestContext());
});

// ---------------------------------------------------------------------------
// The one entry point for pages
// ---------------------------------------------------------------------------

/**
 * Who may see this page: signs the person in (to their account, or to the show's storefront,
 * depending on the action) and checks the action through the authz module. Anyone not allowed
 * gets "not found", so pages never reveal what exists.
 */
export async function requireActor(action: ActionName, target: Target = {}): Promise<Grant> {
  if (audienceOf(action) === 'exhibitor') {
    if (!target.showId) throw new Error(`${action} needs a show`);
    const show = await getShow(target.showId);
    if (!show) notFound();
    const exhibitor = await getExhibitor(show.id);
    if (!exhibitor) redirect(`/${show.slug}/sign-in`);
    return guard(() => authorize(exhibitor, action, target));
  }
  const actor = await requireSignedIn();
  return guard(() => authorize(actor, action, target));
}

async function guard(check: () => Promise<Grant>): Promise<Grant> {
  try {
    return await check();
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
}
