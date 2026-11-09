import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { z, ZodError } from 'zod';
import { AppError } from './errors';
import { RateLimitedError } from './security/rate-limit';
import { audienceOf, authorize, type ActionName, type Grant, type Target } from './authz';
import { getCurrentAuth, getExhibitor } from './auth/current';
import type { Actor } from './auth/actor';
import type { ActionResult } from '@/lib/action-result';

export type { ActionResult };

function fieldErrorsOf(err: ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.');
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

/**
 * Every server action runs through here (CLAUDE.md, "Permissions"): who is signed in, may they do
 * this named action (src/server/authz), is the input valid (zod), then the work. Known problems
 * come back as plain sentences; anything else is logged and the person sees a general message,
 * never a stack trace.
 *
 * `target` picks the show the action is about from the checked input. The work receives the grant
 * so it never has to check permissions itself (services still check again, which is cheap and
 * keeps them safe to call from anywhere).
 */
export async function runAction<S extends z.ZodType, T>(opts: {
  action: ActionName;
  schema: S;
  input: unknown;
  target?: (data: z.infer<S>) => Target;
  work: (actor: Actor, data: z.infer<S>, grant: Grant) => Promise<T>;
  message?: string;
}): Promise<ActionResult<T>> {
  try {
    const parsed = opts.schema.safeParse(opts.input);
    if (!parsed.success) return { ok: false, error: 'Check the highlighted fields.', fieldErrors: fieldErrorsOf(parsed.error) };
    const data = parsed.data as z.infer<S>;
    const target = opts.target?.(data) ?? {};

    let actor: Actor | null = null;
    if (audienceOf(opts.action) === 'exhibitor') {
      actor = target.showId ? await getExhibitor(target.showId) : null;
      if (!actor) return { ok: false, error: 'Your sign-in has ended. Sign in again to carry on.' };
    } else {
      const auth = await getCurrentAuth();
      if (!auth || auth.needsSecondFactor || auth.needsTwoFactorSetup || auth.needsPasswordChange) return { ok: false, error: 'Your sign-in has ended. Sign in again to carry on.' };
      actor = auth.actor;
    }
    const grant = await authorize(actor, opts.action, target, { write: true });
    const result = await opts.work(actor, data, grant);
    return { ok: true, data: result, message: opts.message };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AppError) {
      if (err.code === 'not_found' || err.code === 'forbidden') {
        return { ok: false, error: err.message || 'You don’t have access to do that.', fieldErrors: err.fieldErrors };
      }
      return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
    }
    if (err instanceof RateLimitedError) return { ok: false, error: err.message };
    if (err instanceof ZodError) return { ok: false, error: 'Check the highlighted fields.', fieldErrors: fieldErrorsOf(err) };
    console.error(`Action ${opts.action} failed:`, err instanceof Error ? err.message : err);
    return { ok: false, error: 'Something went wrong. Try again, and tell Media10 if it keeps happening.' };
  }
}

/**
 * For the few actions that happen before anyone is signed in (asking for a sign-in code, accepting
 * an invitation): no permission to check, but the same input checks and friendly errors.
 */
export async function runPublicAction<S extends z.ZodType, T>(opts: { schema: S; input: unknown; work: (data: z.infer<S>) => Promise<T>; message?: string }): Promise<ActionResult<T>> {
  try {
    const parsed = opts.schema.safeParse(opts.input);
    if (!parsed.success) return { ok: false, error: 'Check the highlighted fields.', fieldErrors: fieldErrorsOf(parsed.error) };
    return { ok: true, data: await opts.work(parsed.data as z.infer<S>), message: opts.message };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AppError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
    if (err instanceof RateLimitedError) return { ok: false, error: err.message };
    console.error('Public action failed:', err instanceof Error ? err.message : err);
    return { ok: false, error: 'Something went wrong. Try again in a moment.' };
  }
}
