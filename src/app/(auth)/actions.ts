'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { runPublicAction, type ActionResult } from '@/server/actions';
import { beginTotpEnrollment, confirmTotpEnrollment, requestSignInCode, setPassword, signInWithPassword, verifySecondFactor, verifySignInCode } from '@/server/auth/login';
import { createSession, revokeSession } from '@/server/auth/sessions';
import { getCurrentAuth, renewSession, requestContext, safeNextPath, setSessionCookie, signOutCurrentSession } from '@/server/auth/current';
import { acceptInvitation, sendInvitationCode } from '@/server/auth/invitations';
import { invalid } from '@/server/errors';
import { auditEvent } from '@/server/audit';

/**
 * Signing in to an account. These run before anyone is signed in (or half-way through signing in),
 * so they use runPublicAction: same input checks and friendly errors, no permission to check.
 */

const email = z.string().trim().min(3, 'Enter your email address.').max(254);
const next = z.string().max(500).nullable().optional();

async function startSessionAndGo(userId: string, nextPath: string | null | undefined) {
  const ctx = await requestContext();
  // A new sign-in replaces whatever session this browser had.
  const previous = await getCurrentAuth();
  if (previous) await revokeSession(previous.session.id);
  const { token, expiresAt, session } = await createSession(userId, ctx);
  await setSessionCookie(token, expiresAt);
  const target = safeNextPath(nextPath);
  if (!session.twoFactorVerified) redirect(`/two-factor?next=${encodeURIComponent(target)}`);
  redirect(target);
}

export async function requestCodeAction(input: { email: string }): Promise<ActionResult> {
  return runPublicAction({ schema: z.object({ email }), input, work: async (d) => requestSignInCode(d.email, await requestContext()) });
}

export async function verifyCodeAction(input: { email: string; code: string; next?: string | null }): Promise<ActionResult> {
  return runPublicAction({
    schema: z.object({ email, code: z.string().max(20), next }),
    input,
    work: async (d) => {
      const user = await verifySignInCode(d.email, d.code, await requestContext());
      await startSessionAndGo(user.id, d.next);
    },
  });
}

export async function passwordSignInAction(input: { email: string; password: string; next?: string | null }): Promise<ActionResult> {
  return runPublicAction({
    schema: z.object({ email, password: z.string().min(1, 'Enter your password.').max(200), next }),
    input,
    work: async (d) => {
      const user = await signInWithPassword(d.email, d.password, await requestContext());
      await startSessionAndGo(user.id, d.next);
    },
  });
}

export async function twoFactorAction(input: { code: string; next?: string | null }): Promise<ActionResult> {
  return runPublicAction({
    schema: z.object({ code: z.string().min(1, 'Enter the code from your app.').max(20), next }),
    input,
    work: async (d) => {
      const auth = await getCurrentAuth();
      if (!auth) redirect('/sign-in');
      const ok = await verifySecondFactor(auth.user.id, d.code, await requestContext());
      if (!ok) throw invalid('That code didn’t work. Try the newest code from your app, or a recovery code.');
      await renewSession(auth, { twoFactorVerified: true });
      redirect(safeNextPath(d.next));
    },
  });
}

export async function beginEnrollmentAction(): Promise<ActionResult<{ secret: string; qrDataUrl: string }>> {
  return runPublicAction({
    schema: z.object({}),
    input: {},
    work: async () => {
      const auth = await getCurrentAuth();
      if (!auth) redirect('/sign-in');
      const { secret, qrDataUrl } = await beginTotpEnrollment(auth.actor);
      return { secret, qrDataUrl };
    },
  });
}

export async function confirmEnrollmentAction(input: { code: string }): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  return runPublicAction({
    schema: z.object({ code: z.string().min(6, 'Enter the six-digit code from your app.').max(10) }),
    input,
    work: async (d) => {
      const auth = await getCurrentAuth();
      if (!auth) redirect('/sign-in');
      const recoveryCodes = await confirmTotpEnrollment(auth.actor, d.code, auth.session);
      // Setting up two-factor with a fresh code counts as passing it, on a fresh session.
      await renewSession(auth, { twoFactorVerified: true });
      return { recoveryCodes };
    },
  });
}

export async function signOutAction() {
  const auth = await getCurrentAuth();
  if (auth) await auditEvent(auth.actor, { action: 'auth.sign_out', summary: 'Signed out', entityType: 'user', entityId: auth.user.id });
  await signOutCurrentSession();
  redirect('/sign-in?signedOut=1');
}

export async function sendInviteCodeAction(input: { token: string }): Promise<ActionResult> {
  return runPublicAction({
    schema: z.object({ token: z.string().min(20).max(100) }),
    input,
    message: 'We’ve emailed you a code.',
    work: async (d) => sendInvitationCode(d.token, await requestContext()),
  });
}

export async function acceptInviteAction(input: { token: string; name: string; code?: string | null; password?: string | null }): Promise<ActionResult> {
  return runPublicAction({
    schema: z.object({ token: z.string().min(20).max(100), name: z.string().max(120), code: z.string().max(20).nullish(), password: z.string().max(200).nullish() }),
    input,
    work: async (d) => {
      const auth = await getCurrentAuth();
      const signedInEmail = auth && !auth.needsSecondFactor && !auth.needsTwoFactorSetup ? auth.user.email : null;
      const user = await acceptInvitation(d.token, { name: d.name, code: d.code ?? undefined, password: d.password ?? undefined }, await requestContext(), { signedInEmail });
      // Any earlier session in this browser belongs to someone else; start fresh.
      await signOutCurrentSession();
      await startSessionAndGo(user.id, '/start');
    },
  });
}

export async function choosePasswordAction(input: { password: string; next?: string | null }): Promise<ActionResult> {
  return runPublicAction({
    schema: z.object({ password: z.string().min(1, 'Enter a password.').max(200), next }),
    input,
    work: async (d) => {
      const auth = await getCurrentAuth();
      if (!auth) redirect('/sign-in');
      await setPassword(auth.actor, d.password, auth.session);
      redirect(safeNextPath(d.next));
    },
  });
}
