'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { runPublicAction, type ActionResult } from '@/server/actions';
import { clearStorefrontCookie, getExhibitor, requestContext, setStorefrontCookie } from '@/server/auth/current';
import { getShowBySlug } from '@/server/services/shows';
import { endExhibitorSession, requestExhibitorCode, signInWithLink, verifyExhibitorCode } from '@/server/services/storefront-auth';
import { tokenProblemText } from '@/server/security/connection-key';
import { notFound } from '@/server/errors';
import { auditEvent } from '@/server/audit';

/**
 * Storefront sign-in. The show always comes from the web address and the database, never from
 * anything else the browser sends.
 */
const slug = z.string().regex(/^[a-z0-9-]{1,60}$/);

async function showFor(s: string) {
  const show = await getShowBySlug(s);
  if (!show) throw notFound();
  return show;
}

export async function requestStorefrontCodeAction(input: { slug: string; email: string }): Promise<ActionResult> {
  return runPublicAction({
    schema: z.object({ slug, email: z.string().trim().min(3, 'Enter your email address.').max(254) }),
    input,
    work: async (d) => requestExhibitorCode(await showFor(d.slug), d.email, await requestContext()),
  });
}

export async function verifyStorefrontCodeAction(input: { slug: string; email: string; code: string }): Promise<ActionResult> {
  return runPublicAction({
    schema: z.object({ slug, email: z.string().trim().max(254), code: z.string().max(20) }),
    input,
    work: async (d) => {
      const show = await showFor(d.slug);
      const { token, expiresAt } = await verifyExhibitorCode(show, d.email, d.code, await requestContext());
      await setStorefrontCookie(show.slug, token, expiresAt);
      redirect(`/${show.slug}`);
    },
  });
}

export async function linkSignInAction(input: { slug: string; token: string }): Promise<ActionResult<{ problem: string }>> {
  return runPublicAction({
    schema: z.object({ slug, token: z.string().min(10).max(2048) }),
    input,
    work: async (d) => {
      const show = await showFor(d.slug);
      const result = await signInWithLink(show, d.token, await requestContext());
      if (!result.ok) return { problem: tokenProblemText(result.reason) };
      await setStorefrontCookie(show.slug, result.token, result.expiresAt);
      redirect(`/${show.slug}`);
    },
  });
}

export async function storefrontSignOutAction(form: FormData) {
  const parsed = slug.safeParse(form.get('slug'));
  if (!parsed.success) redirect('/');
  const show = await getShowBySlug(parsed.data);
  if (show) {
    const exhibitor = await getExhibitor(show.id);
    if (exhibitor?.sessionId) {
      await endExhibitorSession(exhibitor.sessionId);
      await auditEvent(exhibitor, { action: 'storefront.sign_out', summary: 'Signed out of the storefront', showId: show.id });
    }
    await clearStorefrontCookie(show.slug);
  }
  redirect(`/${parsed.data}/sign-in?signedOut=1`);
}
