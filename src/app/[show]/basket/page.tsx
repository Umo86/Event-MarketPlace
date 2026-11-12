import type { Metadata } from 'next';
import { Alert, Group, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { requireActor } from '@/server/auth/current';
import { basketFor } from '@/server/services/orders';
import { LinkAnchor, LinkButton } from '@/components/ui/links';
import { PlaceOrder, QuantityControl, RemoveUnavailable } from '@/components/storefront/basket-actions';
import { StandPicker } from '@/components/storefront/stand-picker';
import { money } from '@/lib/format';
import { loadStorefront } from '../load';
import { pickStand } from '../stand';

export const metadata: Metadata = { title: 'Basket' };

/** The basket, grouped by supplier: each supplier is paid separately, and invoices you separately. */
export default async function BasketPage({ params, searchParams }: PageProps<'/[show]/basket'>) {
  const { show: slug } = await params;
  const sp = await searchParams;
  const { show } = await loadStorefront(slug);
  const { actor } = await requireActor('storefront.browse', { showId: show.id });
  const { stands, stand } = await pickStand(actor, sp.stand);
  if (!stand) return <Alert color="yellow">We can’t find a stand for you at this show. Contact the show team.</Alert>;
  const b = await basketFor(actor, show.id, stand.standId);
  const qs = stands.length > 1 ? `?stand=${stand.standId}` : '';
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <h1 className="page-title">Your basket</h1>
          <Text c="dimmed" mt={4}>
            For stand {stand.number} · {stand.company}
          </Text>
        </div>
        <StandPicker stands={stands.map((s) => ({ standId: s.standId, number: s.number, company: s.company }))} current={stand.standId} />
      </Group>
      {b.unavailable.length ? (
        <Alert color="yellow" title="Some things can’t be ordered any more">
          <Stack gap={6}>
            {b.unavailable.map((u) => (
              <Group key={u.productId} gap="sm">
                <Text fz="sm">{u.name}</Text>
                <RemoveUnavailable slug={slug} standId={stand.standId} productId={u.productId} name={u.name} />
              </Group>
            ))}
          </Stack>
        </Alert>
      ) : null}
      {b.groups.length ? (
        <>
          {b.groups.map((g) => (
            <Paper key={g.supplierId} withBorder radius="md" p="lg" style={{ borderColor: 'var(--em-line)' }} data-testid={`basket-${g.supplierName}`}>
              <Title order={2} fz="md" mb={4}>
                {g.supplierName}
              </Title>
              <Text fz="xs" c="dimmed" mb="sm">
                {g.organiser ? 'Supplied by the show organiser.' : 'Paid to this supplier directly. They send you their own VAT invoice.'}
              </Text>
              <Table fz="sm" verticalSpacing="xs">
                <TableThead>
                  <TableTr>
                    <TableTh>Item</TableTh>
                    <TableTh ta="right">Price</TableTh>
                    <TableTh ta="right">Quantity</TableTh>
                    <TableTh ta="right">Before VAT</TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {g.lines.map((l) => (
                    <TableTr key={l.productId}>
                      <TableTd>
                        {l.name}
                        {l.band !== 'standard' ? (
                          <Text fz="xs" c="dimmed">
                            {l.band === 'early' ? 'Early-bird price' : 'Late price'}
                          </Text>
                        ) : null}
                      </TableTd>
                      <TableTd ta="right">{money(l.unitPence)}</TableTd>
                      <TableTd ta="right">
                        <QuantityControl slug={slug} standId={stand.standId} productId={l.productId} name={l.name} quantity={l.quantity} />
                      </TableTd>
                      <TableTd ta="right">{money(l.netPence)}</TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
              <Stack gap={2} mt="sm" align="flex-end">
                <Text fz="sm">Before VAT {money(g.netPence)}</Text>
                <Text fz="sm">VAT {money(g.vatPence)}</Text>
                <Text fz="sm" fw={650}>
                  {g.supplierName} total {money(g.totalPence)}
                </Text>
              </Stack>
            </Paper>
          ))}
          <Paper withBorder radius="md" p="lg" style={{ borderColor: 'var(--em-line)' }}>
            <Stack gap="md">
              <Group justify="space-between">
                <div>
                  <Text fz="sm">
                    Before VAT {money(b.netPence)} · VAT {money(b.vatPence)}
                  </Text>
                  <Text fw={700} fz="xl" data-testid="basket-total">
                    Total {money(b.totalPence)}
                  </Text>
                </div>
                <Text fz="sm" c="dimmed" maw={420}>
                  You enter your card once. Each supplier is then paid separately, so you’ll see {b.groups.length === 1 ? 'one payment' : `${b.groups.length} payments`} on your statement.
                </Text>
              </Group>
              {b.canOrder ? (
                <PlaceOrder slug={slug} standId={stand.standId} disabled={b.unavailable.length > 0} />
              ) : (
                <Alert color="yellow">Ordering isn’t open right now.</Alert>
              )}
            </Stack>
          </Paper>
        </>
      ) : (
        <Paper withBorder radius="md" p="lg" style={{ borderColor: 'var(--em-line)' }}>
          <Text>Your basket is empty.</Text>
          <Group mt="sm">
            <LinkButton href={`/${slug}/shop${qs}`}>Order services</LinkButton>
            <LinkAnchor href={`/${slug}/orders`}>Your orders</LinkAnchor>
          </Group>
        </Paper>
      )}
    </Stack>
  );
}
