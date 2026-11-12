import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Stack } from '@mantine/core';
import { Panel } from '@/components/ui/panel';
import { OrderDetail } from '@/components/orders/order-views';
import { RefundForm } from '@/components/orders/refund-form';
import { can } from '@/server/authz';
import { supplierOrderDetail } from '@/server/services/reports';
import { AppError } from '@/server/errors';
import { loadShow } from '../../load';

export const metadata: Metadata = { title: 'Order' };

export default async function ShowOrderPage({ params }: PageProps<'/admin/shows/[showId]/orders/[supplierOrderId]'>) {
  const { showId, supplierOrderId } = await params;
  const { actor, show } = await loadShow(showId, 'orders.view');
  const d = await supplierOrderDetail(actor, supplierOrderId, { kind: 'show', showId: show.id }).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });
  const canRefund = await can(actor, 'orders.refund', { showId });
  const refundable = d.row.status === 'paid' || d.row.status === 'part_refunded';
  return (
    <Stack gap="lg">
      <Panel title={`${d.row.orderNumber} · ${d.row.supplierName}`}>
        <OrderDetail d={d} showFee />
      </Panel>
      {canRefund && refundable ? (
        <Panel title="Refund" description="Refunds go back to the exhibitor’s card. Media10’s commission is returned in proportion. A reason is needed and recorded.">
          <RefundForm
            supplierOrderId={d.row.id}
            via="show"
            onBehalf={d.row.organiser === 'organiser' ? undefined : d.row.supplierName}
            lines={d.lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, leftPence: l.totalPence - l.refundedPence }))}
          />
        </Panel>
      ) : null}
    </Stack>
  );
}
