import type { Metadata } from 'next';
import { Alert, Badge, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { requireActor } from '@/server/auth/current';
import { storefrontProducts } from '@/server/services/catalogue';
import { basketFor } from '@/server/services/orders';
import { storefrontCategories } from '@/server/services/categories';
import { LinkButton } from '@/components/ui/links';
import { AddToBasket } from '@/components/storefront/add-to-basket';
import { StandPicker } from '@/components/storefront/stand-picker';
import { money, percentFromBps } from '@/lib/format';
import { canOrder, orderingState } from '@/lib/ordering';
import { loadStorefront } from '../load';
import { pickStand } from '../stand';
import styles from '../storefront.module.css';

export const metadata: Metadata = { title: 'Order services' };

const BAND = { early: 'Early-bird price', late: 'Late price', standard: null } as const;

/** Everything this stand can order, by category, at today's prices. */
export default async function ShopPage({ params, searchParams }: PageProps<'/[show]/shop'>) {
  const { show: slug } = await params;
  const sp = await searchParams;
  const { show } = await loadStorefront(slug);
  const { actor } = await requireActor('storefront.browse', { showId: show.id });
  const { stands, stand } = await pickStand(actor, sp.stand);
  if (!stand) {
    return <Alert color="yellow">We can’t find a stand for you at this show. Contact the show team.</Alert>;
  }
  const [items, categories, basket] = await Promise.all([storefrontProducts(actor, show.id, stand.standTypeKey ?? null), storefrontCategories(actor, show.id), basketFor(actor, show.id, stand.standId)]);
  const inBasket = new Map(basket.groups.flatMap((g) => g.lines.map((l) => [l.productId, l.quantity] as const)));
  const open = canOrder(orderingState(show));
  const qs = stands.length > 1 ? `?stand=${stand.standId}` : '';
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <h1 className="page-title">Order services</h1>
          <Text c="dimmed" mt={4}>
            For stand {stand.number}
            {stand.standType ? ` (${stand.standType})` : ''}. Prices are shown before VAT, with the VAT underneath.
          </Text>
        </div>
        <Group gap="sm">
          <StandPicker stands={stands.map((s) => ({ standId: s.standId, number: s.number, company: s.company }))} current={stand.standId} />
          <LinkButton href={`/${slug}/basket${qs}`} variant="default">
            Basket ({basket.count})
          </LinkButton>
        </Group>
      </Group>
      {!open ? <Alert color="yellow">Ordering isn’t open right now, so you can look but not order.</Alert> : null}
      {categories.map((c) => {
        const list = items.filter((p) => p.categoryId === c.id);
        if (!list.length) return null;
        return (
          <section key={c.id} aria-labelledby={`cat-${c.id}`}>
            <Title order={2} fz="lg" id={`cat-${c.id}`}>
              {c.name}
            </Title>
            <Text fz="sm" c="dimmed" mb="sm">
              {c.description ? `${c.description} · ` : ''}Supplied by {c.supplierName}
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
              {list.map((p) => (
                <Paper key={p.id} withBorder radius="md" p="md" style={{ borderColor: 'var(--em-line)', display: 'flex', flexDirection: 'column', gap: 8 }} data-testid={`shop-${p.name}`}>
                  {p.imageFileId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/files/${p.imageFileId}`} alt="" style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 6 }} />
                  ) : null}
                  <Text fw={650}>{p.name}</Text>
                  {p.description ? (
                    <Text fz="sm" c="dimmed">
                      {p.description}
                    </Text>
                  ) : null}
                  <div>
                    <Group gap="xs">
                      <Text fw={700} fz="lg">
                        {money(p.unitPence)}
                      </Text>
                      <Text fz="sm" c="dimmed">
                        {p.unit === 'each' ? 'each' : `per ${p.unit}`}
                      </Text>
                      {BAND[p.band] ? <span className={styles.highlight}>{BAND[p.band]}</span> : null}
                    </Group>
                    <Text fz="xs" c="dimmed">
                      {money(p.unitPence + p.vatPence)} with VAT at {percentFromBps(p.vatRateBps)}
                      {p.band !== 'standard' && p.unitPence !== p.standardPence ? ` · usually ${money(p.standardPence)}` : ''}
                    </Text>
                  </div>
                  {p.stockLeft !== null ? <Badge color={p.stockLeft > 0 ? 'gray' : 'red'} variant="light">{p.stockLeft > 0 ? `${p.stockLeft} left` : 'Sold out'}</Badge> : null}
                  <div style={{ marginTop: 'auto' }}>
                    <AddToBasket slug={slug} standId={stand.standId} productId={p.id} name={p.name} inBasket={inBasket.get(p.id) ?? 0} max={p.stockLeft} disabled={!open || p.stockLeft === 0} />
                  </div>
                </Paper>
              ))}
            </SimpleGrid>
          </section>
        );
      })}
      {!items.length ? <Text c="dimmed">Nothing to order for this stand yet. The show’s suppliers are still adding their services.</Text> : null}
    </Stack>
  );
}
