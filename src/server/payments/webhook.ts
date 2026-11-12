import 'server-only';
import { getDb } from '../db/client';
import { stripeEvents } from '../db/schema';
import { consumeRateLimit } from '../security/rate-limit';
import { applyMoneyEvent, handleConnectEvent } from '../services/connect';
import { chargeOrder } from '../services/orders';
import { orders } from '../db/schema';
import { eq } from 'drizzle-orm';
import { payments, WebhookSignatureError } from './provider';

/**
 * Both Stripe webhook endpoints (docs/deployment.md lists them and their events). Each has its own
 * signing secret. Every event's signature is checked over the exact bytes Stripe sent, anything
 * older than five minutes is refused, and each event id is applied once only.
 */
const MAX_BYTES = 512 * 1024;

const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function clientIp(req: Request) {
  return req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function receiveStripeWebhook(req: Request, endpoint: 'platform' | 'connect'): Promise<Response> {
  const p = payments();
  // No Stripe key (a developer's computer, or a live site before Umit adds the keys): nothing to receive.
  if (!p || p.kind !== 'stripe') return reply(404, { error: 'Not found' });
  // Generous: Stripe can send bursts. This only stops floods of unsigned junk.
  const limit = await consumeRateLimit(`stripe-webhook:${endpoint}:${clientIp(req)}`, 600, 60);
  if (!limit.allowed) return reply(429, { error: 'Too many requests' });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return reply(413, { error: 'Too large' });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return reply(413, { error: 'Too large' });

  let event;
  try {
    event = await p.verifyWebhook(raw, req.headers.get('stripe-signature'), endpoint);
  } catch (err) {
    if (err instanceof WebhookSignatureError) return reply(400, { error: 'Signature check failed' });
    throw err;
  }

  try {
    if (endpoint === 'connect') {
      const result = await handleConnectEvent(event);
      return reply(200, { received: true, result });
    }
    // Media10's own account: saved cards (SetupIntents) and Media10's own charges.
    const db = await getDb();
    const [fresh] = await db.insert(stripeEvents).values({ id: event.id, endpoint, type: event.type, account: event.account }).onConflictDoNothing().returning({ id: stripeEvents.id });
    if (!fresh) return reply(200, { received: true, result: 'duplicate' });
    if (event.type === 'setup_intent.succeeded') {
      const result = await chargeAfterSetup(event.object);
      return reply(200, { received: true, result });
    }
    const result = await applyMoneyEvent({ ...event, account: null });
    return reply(200, { received: true, result });
  } catch (err) {
    // A 500 makes Stripe send it again later, which is what we want if our database hiccupped.
    console.error(`Stripe ${endpoint} webhook ${event.type} ${event.id} failed:`, err instanceof Error ? err.message : err);
    return reply(500, { error: 'Not applied; send again' });
  }
}

/**
 * A card was saved (in case the person closed the page before we charged): charge the order's
 * unpaid parts. chargeOrder locks each part and uses the same idempotency key as the page would,
 * so this never charges twice.
 */
async function chargeAfterSetup(si: Record<string, unknown>) {
  const id = typeof si.id === 'string' ? si.id : null;
  const pm = typeof si.payment_method === 'string' ? si.payment_method : null;
  if (!id || !pm) return 'ignored';
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.stripeSetupIntentId, id)).limit(1);
  if (!order) return 'ignored';
  if (!order.stripePaymentMethodId) await db.update(orders).set({ stripePaymentMethodId: pm }).where(eq(orders.id, order.id));
  if (order.stripePaymentMethodId && order.stripePaymentMethodId !== pm) return 'ignored';
  await chargeOrder(order.id);
  return 'applied';
}
