import type { Metadata } from 'next';
import { Button, Group, Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { OrderTable, TakingsTable } from '@/components/orders/order-views';
import { summarise, supplierOrderRows } from '@/server/services/reports';
import { loadSupplier } from '../load';

export const metadata: Metadata = { title: 'Orders' };

export default async function SupplierOrdersPage({ params }: PageProps<'/supplier/[supplierId]/orders'>) {
  const { supplierId } = await params;
  const { actor, supplier: s } = await loadSupplier(supplierId);
  const rows = await supplierOrderRows(actor, supplierId);
  return (
    <>
      <PageHeader eyebrow={s.name} title="Orders" description="Every order for you, with the stand it’s for. Exhibitors pay you directly; Media10’s commission is taken by Stripe as each payment is made." />
      <Stack gap="lg">
        <Panel title="Takings">
          <TakingsTable summary={summarise(rows)} />
        </Panel>
        <Panel>
          <Group>
            <Button component="a" href={`/supplier/${supplierId}/orders/export`} variant="default">
              Download as CSV
            </Button>
          </Group>
          <OrderTable rows={rows} hrefFor={(id) => `/supplier/${supplierId}/orders/${id}`} showSupplier={false} showFee />
        </Panel>
      </Stack>
    </>
  );
}
