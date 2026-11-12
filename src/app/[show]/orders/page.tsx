import type { Metadata } from 'next';
import { Badge, Paper, Stack, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { requireActor } from '@/server/auth/current';
import { myOrders } from '@/server/services/orders';
import { LinkAnchor } from '@/components/ui/links';
import { dateTime, money } from '@/lib/format';
import { ORDER_STATUS_COLOUR, ORDER_STATUS_LABEL } from '@/lib/order-status';
import { loadStorefront } from '../load';

export const metadata: Metadata = { title: 'Your orders' };

export default async function OrdersPage({ params }: PageProps<'/[show]/orders'>) {
  const { show: slug } = await params;
  const { show } = await loadStorefront(slug);
  const { actor } = await requireActor('storefront.browse', { showId: show.id });
  const rows = await myOrders(actor, show.id);
  return (
    <Stack gap="lg">
      <h1 className="page-title">Your orders</h1>
      <Paper withBorder radius="md" p="lg" style={{ borderColor: 'var(--em-line)' }}>
        {rows.length ? (
          <TableScrollContainer minWidth={560}>
            <Table fz="sm" verticalSpacing="sm">
              <TableThead>
                <TableTr>
                  <TableTh>Order</TableTh>
                  <TableTh>Stand</TableTh>
                  <TableTh ta="right">Total</TableTh>
                  <TableTh>Status</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {rows.map((o) => (
                  <TableTr key={o.id}>
                    <TableTd>
                      <LinkAnchor href={`/${slug}/orders/${o.id}`} fw={600}>
                        {o.number}
                      </LinkAnchor>
                      <Text fz="xs" c="dimmed">
                        {dateTime(o.createdAt, show.timezone)}
                      </Text>
                    </TableTd>
                    <TableTd>{o.standNumber}</TableTd>
                    <TableTd ta="right">{money(o.totalPence)}</TableTd>
                    <TableTd>
                      <Badge color={ORDER_STATUS_COLOUR[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </TableScrollContainer>
        ) : (
          <Text c="dimmed">No orders yet.</Text>
        )}
      </Paper>
    </Stack>
  );
}
