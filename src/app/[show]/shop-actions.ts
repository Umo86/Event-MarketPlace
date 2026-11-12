'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction, type ActionResult } from '@/server/actions';
import { getShowBySlug } from '@/server/services/shows';
import { completePayment, placeOrder, setBasketQuantity, simulatePayment, startPayment } from '@/server/services/orders';

/**
 * Ordering on the storefront. The show is always worked out from the address (the slug) and the
 * database; prices always come from the database (CLAUDE.md, "Public routes").
 */

const slug = z.string().regex(/^[a-z0-9-]{1,60}$/);

async function showIdFor(s: string) {
  return (await getShowBySlug(s))?.id ?? '00000000-0000-0000-0000-000000000000';
}

export async function setQuantityAction(input: unknown): Promise<ActionResult> {
  const schema = z.object({ slug, standId: z.string().uuid(), productId: z.string().uuid(), quantity: z.number().int().min(0).max(999) });
  const parsed = schema.safeParse(input);
  const showId = parsed.success ? await showIdFor(parsed.data.slug) : '';
  return runAction({
    action: 'storefront.order',
    schema,
    input,
    target: () => ({ showId }),
    work: async (actor, d) => {
      await setBasketQuantity(actor, showId, d);
      revalidatePath(`/${d.slug}`, 'layout');
    },
  });
}

export async function placeOrderAction(input: unknown): Promise<ActionResult<{ orderId: string }>> {
  const schema = z.object({ slug, standId: z.string().uuid(), poNumber: z.string().max(60).nullish() });
  const parsed = schema.safeParse(input);
  const showId = parsed.success ? await showIdFor(parsed.data.slug) : '';
  return runAction({
    action: 'storefront.order',
    schema,
    input,
    target: () => ({ showId }),
    work: async (actor, d) => {
      const order = await placeOrder(actor, showId, d);
      return { orderId: order.id };
    },
  });
}

export async function startPaymentAction(input: unknown): Promise<ActionResult<{ mode: 'stripe' | 'simulator'; clientSecret: string | null; publishableKey: string | null }>> {
  const schema = z.object({ slug, orderId: z.string().uuid() });
  const parsed = schema.safeParse(input);
  const showId = parsed.success ? await showIdFor(parsed.data.slug) : '';
  return runAction({ action: 'storefront.order', schema, input, target: () => ({ showId }), work: (actor, d) => startPayment(actor, showId, d.orderId) });
}

export async function completePaymentAction(input: unknown): Promise<ActionResult> {
  const schema = z.object({ slug, orderId: z.string().uuid(), setupIntentId: z.string().regex(/^seti_[A-Za-z0-9]{6,80}$/) });
  const parsed = schema.safeParse(input);
  const showId = parsed.success ? await showIdFor(parsed.data.slug) : '';
  return runAction({
    action: 'storefront.order',
    schema,
    input,
    target: () => ({ showId }),
    work: async (actor, d) => {
      await completePayment(actor, showId, d.orderId, d.setupIntentId);
      revalidatePath(`/${d.slug}`, 'layout');
    },
  });
}

/** The payment simulator's "Pay with a test card". Refused anywhere the simulator isn't running. */
export async function simulatePaymentAction(input: unknown): Promise<ActionResult> {
  const schema = z.object({ slug, orderId: z.string().uuid(), declineSupplierId: z.string().uuid().nullish() });
  const parsed = schema.safeParse(input);
  const showId = parsed.success ? await showIdFor(parsed.data.slug) : '';
  return runAction({
    action: 'storefront.order',
    schema,
    input,
    target: () => ({ showId }),
    work: async (actor, d) => {
      await simulatePayment(actor, showId, d.orderId, { declineSupplierId: d.declineSupplierId });
      revalidatePath(`/${d.slug}`, 'layout');
    },
  });
}
