import type { Metadata } from 'next';
import { Button, Group, Stack } from '@mantine/core';
import { Panel } from '@/components/ui/panel';
import { OrderTable, TakingsTable } from '@/components/orders/order-views';
import { can } from '@/server/authz';
import { showOrderRows, summarise } from '@/server/services/reports';
import { loadShow } from '../load';

export const metadata: Metadata = { title: 'Orders' };

/** Every supplier order at the show, and takings by supplier. */
export default async function ShowOrdersPage({ params }: PageProps<'/admin/shows/[showId]/orders'>) {
  const { showId } = await params;
  const { actor, show } = await loadShow(showId, 'orders.view');
  const [rows, reports] = await Promise.all([showOrderRows(actor, show.id), can(actor, 'reports.view', { showId })]);
  return (
    <Stack gap="lg">
      {reports ? (
        <Panel title="Takings by supplier" description="What exhibitors paid, refunds, Media10’s commission (less what was returned on refunds) and what each supplier keeps before Stripe’s own fees.">
          <TakingsTable summary={summarise(rows)} />
        </Panel>
      ) : null}
      <Panel title="Orders" description="Each supplier’s part of an order is paid, invoiced and refunded on its own.">
        <Group>
          <Button component="a" href={`/admin/shows/${show.id}/orders/export`} variant="default">
            Download as CSV
          </Button>
        </Group>
        <OrderTable rows={rows} hrefFor={(id) => `/admin/shows/${show.id}/orders/${id}`} showSupplier showFee />
      </Panel>
    </Stack>
  );
}
