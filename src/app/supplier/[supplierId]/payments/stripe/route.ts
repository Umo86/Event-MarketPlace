import { redirect } from 'next/navigation';
import { requireActor } from '@/server/auth/current';
import { resumeStripeOnboarding } from '@/server/services/connect';
import { asUser } from '@/server/authz';

/**
 * Stripe sends people here when a set-up link has expired or been used. It makes a new link for the
 * account already made (never a new account) and goes straight back to Stripe.
 */
export async function GET(_req: Request, ctx: RouteContext<'/supplier/[supplierId]/payments/stripe'>) {
  const { supplierId } = await ctx.params;
  const { actor } = await requireActor('supplier.manage', { supplierId });
  let url: string | null = null;
  try {
    url = await resumeStripeOnboarding(asUser(actor), supplierId);
  } catch (err) {
    console.error('Making a new Stripe link failed', err instanceof Error ? err.message : err);
  }
  redirect(url ?? `/supplier/${supplierId}/payments?stripe=expired`);
}
