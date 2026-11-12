import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Paper, Stack, Text } from '@mantine/core';
import { requireActor } from '@/server/auth/current';
import { myOrder } from '@/server/services/orders';
import { AppError } from '@/server/errors';
import { PaymentForm } from '@/components/storefront/payment-form';
import { money } from '@/lib/format';
import { loadStorefront } from '../../../load';

export const metadata: Metadata = { title: 'Pay' };

/** The show's own branded payment page. Card details go straight to Stripe; we never see them. */
export default async function PayPage({ params }: PageProps<'/[show]/orders/[orderId]/pay'>) {
  const { show: slug, orderId } = await params;
  const { show } = await loadStorefront(slug);
  const { actor } = await requireActor('storefront.order', { showId: show.id });
  const { order, parts } = await myOrder(actor, show.id, orderId).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });
  const toPay = parts.filter((p) => p.status === 'pending' || p.status === 'payment_needed');
  if (!toPay.length) redirect(`/${slug}/orders/${order.id}`);
  const total = toPay.reduce((a, p) => a + p.totalPence, 0);
  return (
    <Stack gap="lg" maw={640}>
      <div>
        <h1 className="page-title">Pay for {order.number}</h1>
        <Text c="dimmed" mt={4}>
          Stand {order.standNumber}. {toPay.length > 1 ? `Your card is charged once for each supplier: ${toPay.map((p) => `${p.supplierName} ${money(p.totalPence)}`).join(', ')}.` : `${toPay[0].supplierName}: ${money(total)}.`}
        </Text>
      </div>
      <Paper withBorder radius="md" p="lg" style={{ borderColor: 'var(--em-line)' }}>
        <PaymentForm slug={slug} orderId={order.id} totalText={money(total)} suppliers={toPay.map((p) => ({ id: p.supplierId, name: p.supplierName }))} />
      </Paper>
      <Text fz="xs" c="dimmed">
        Your items are held for you for an hour while you pay.
      </Text>
    </Stack>
  );
}
