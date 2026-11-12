import { receiveStripeWebhook } from '@/server/payments/webhook';

/** Events on Media10's own Stripe account, signed with STRIPE_WEBHOOK_SECRET. */
export async function POST(req: Request) {
  return receiveStripeWebhook(req, 'platform');
}
