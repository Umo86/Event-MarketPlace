import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { OrderDetail } from '@/components/orders/order-views';
import { RefundForm } from '@/components/orders/refund-form';
import { can } from '@/server/authz';
import { supplierOrderDetail } from '@/server/services/reports';
import { AppError } from '@/server/errors';
import { loadSupplier } from '../../load';

export const metadata: Metadata = { title: 'Order' };

export default async function SupplierOrderPage({ params }: PageProps<'/supplier/[supplierId]/orders/[supplierOrderId]'>) {
  const { supplierId, supplierOrderId } = await params;
  const { actor, supplier: s } = await loadSupplier(supplierId);
  const d = await supplierOrderDetail(actor, supplierOrderId, { kind: 'supplier', supplierId }).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });
  const canRefund = await can(actor, 'supplier.refund', { supplierId });
  const refundable = d.row.status === 'paid' || d.row.status === 'part_refunded';
  return (
    <>
      <PageHeader eyebrow={s.name} title={d.row.orderNumber} />
      <Stack gap="lg">
        <Panel>
          <OrderDetail d={d} showFee />
        </Panel>
        {canRefund && refundable ? (
          <Panel title="Refund" description="Goes back to the exhibitor’s card from your Stripe account. Media10’s commission on it comes back to you in proportion. The exhibitor is emailed a credit note in your name.">
            <RefundForm supplierOrderId={d.row.id} via="supplier" lines={d.lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, leftPence: l.totalPence - l.refundedPence }))} />
          </Panel>
        ) : null}
      </Stack>
    </>
  );
}
