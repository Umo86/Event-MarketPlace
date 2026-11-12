import { receiveStripeWebhook } from '@/server/payments/webhook';

/** Events on suppliers' connected accounts, signed with STRIPE_CONNECT_WEBHOOK_SECRET. */
export async function POST(req: Request) {
  return receiveStripeWebhook(req, 'connect');
}
