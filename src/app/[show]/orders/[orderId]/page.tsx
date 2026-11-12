import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, Anchor, Badge, Group, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { requireActor } from '@/server/auth/current';
import { myOrder } from '@/server/services/orders';
import { refundsForOrder } from '@/server/services/refunds';
import { AppError } from '@/server/errors';
import { LinkButton } from '@/components/ui/links';
import { dateTime, money } from '@/lib/format';
import { ORDER_STATUS_COLOUR, ORDER_STATUS_LABEL, PART_STATUS_COLOUR, PART_STATUS_LABEL } from '@/lib/order-status';
import { loadStorefront } from '../../load';

export const metadata: Metadata = { title: 'Order' };

/** One order: each supplier's part, its payment, invoice and any refunds. */
export default async function OrderPage({ params }: PageProps<'/[show]/orders/[orderId]'>) {
  const { show: slug, orderId } = await params;
  const { show } = await loadStorefront(slug);
  const { actor } = await requireActor('storefront.browse', { showId: show.id });
  const { order, parts } = await myOrder(actor, show.id, orderId).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });
  const refunds = await refundsForOrder(order.id);
  const toPay = parts.filter((p) => p.status === 'pending' || p.status === 'payment_needed');
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Group gap="sm">
            <h1 className="page-title">{order.number}</h1>
            <Badge color={ORDER_STATUS_COLOUR[order.status]} size="lg">
              {ORDER_STATUS_LABEL[order.status]}
            </Badge>
          </Group>
          <Text c="dimmed" mt={4}>
            Stand {order.standNumber} · {order.companyName} · placed {dateTime(order.createdAt, show.timezone)}
            {order.poNumber ? ` · PO ${order.poNumber}` : ''}
          </Text>
        </div>
        {toPay.length ? (
          <LinkButton href={`/${slug}/orders/${order.id}/pay`} size="md">
            Pay {money(toPay.reduce((a, p) => a + p.totalPence, 0))}
          </LinkButton>
        ) : null}
      </Group>
      {toPay.some((p) => p.status === 'payment_needed') ? (
        <Alert color="red" title="Part of this order isn’t paid">
          {toPay
            .filter((p) => p.paymentError)
            .map((p) => `${p.supplierName}: ${p.paymentError}`)
            .join(' ')}{' '}
          Press Pay to try again with the same card or another one. The rest of your order is paid and confirmed.
        </Alert>
      ) : null}
      {parts.map((p) => {
        const r = refunds.filter((x) => x.supplierOrderId === p.id && x.status === 'succeeded');
        return (
          <Paper key={p.id} withBorder radius="md" p="lg" style={{ borderColor: 'var(--em-line)' }} data-testid={`part-${p.supplierName}`}>
            <Group justify="space-between" mb="sm">
              <Title order={2} fz="md">
                {p.supplierName}
              </Title>
              <Badge color={PART_STATUS_COLOUR[p.status]}>{PART_STATUS_LABEL[p.status]}</Badge>
            </Group>
            <Table fz="sm" verticalSpacing="xs">
              <TableThead>
                <TableTr>
                  <TableTh>Item</TableTh>
                  <TableTh ta="right">Quantity</TableTh>
                  <TableTh ta="right">Before VAT</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {p.lines.map((l) => (
                  <TableTr key={l.id}>
                    <TableTd>{l.description}</TableTd>
                    <TableTd ta="right">{l.quantity}</TableTd>
                    <TableTd ta="right">{money(l.netPence)}</TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
            <Group justify="space-between" mt="sm" align="flex-end">
              <Stack gap={2}>
                {p.invoiceFileId ? (
                  <Anchor href={`/${slug}/orders/${order.id}/files/${p.invoiceFileId}`} className="text-link" fz="sm">
                    Download invoice {p.invoiceNumber}
                  </Anchor>
                ) : p.invoiceNumber ? (
                  <Text fz="sm" c="dimmed">
                    Invoice {p.invoiceNumber} is being made.
                  </Text>
                ) : null}
                {r.map((x) => (
                  <Text key={x.id} fz="sm">
                    Refunded {money(x.amountPence)} on {dateTime(x.updatedAt, show.timezone)}
                    {x.creditNoteFileId ? (
                      <>
                        {' · '}
                        <Anchor href={`/${slug}/orders/${order.id}/files/${x.creditNoteFileId}`} className="text-link" fz="sm">
                          credit note {x.creditNoteNumber}
                        </Anchor>
                      </>
                    ) : null}
                  </Text>
                ))}
              </Stack>
              <Stack gap={0} align="flex-end">
                <Text fz="sm">VAT {money(p.vatPence)}</Text>
                <Text fw={650}>Total {money(p.totalPence)}</Text>
              </Stack>
            </Group>
          </Paper>
        );
      })}
      <Text fw={700} ta="right">
        Order total {money(order.totalPence)}
      </Text>
    </Stack>
  );
}
