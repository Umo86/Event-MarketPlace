import type { Metadata } from 'next';
import { Badge, Group, Stack, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { LinkAnchor } from '@/components/ui/links';
import { showsForSupplier } from '@/server/services/categories';
import { loadSupplier } from '../load';

export const metadata: Metadata = { title: 'Catalogue' };

export default async function SupplierCataloguePage({ params }: PageProps<'/supplier/[supplierId]/catalogue'>) {
  const { supplierId } = await params;
  const { actor, supplier: s } = await loadSupplier(supplierId);
  const served = await showsForSupplier(actor, supplierId, 'supplier.view');
  return (
    <>
      <PageHeader eyebrow={s.name} title="Catalogue" description="Your products and prices for each show. New products and price changes go to the show team to approve before exhibitors see them." />
      <Panel>
        {served.length ? (
          <Stack gap="sm">
            {served.map((sh) => (
              <Group key={sh.id} justify="space-between">
                <div>
                  <LinkAnchor href={`/supplier/${supplierId}/catalogue/${sh.id}`} fw={650}>
                    {sh.name}
                  </LinkAnchor>
                  <Text fz="sm" c="dimmed">
                    {sh.categories.join(', ')}
                  </Text>
                </div>
                {sh.status !== 'live' ? <Badge color="gray">{sh.status === 'draft' ? 'Not open yet' : 'Closed'}</Badge> : null}
              </Group>
            ))}
          </Stack>
        ) : (
          <Text fz="sm" c="dimmed">
            No shows yet. Media10 will add you to the shows you supply, then you can add products here.
          </Text>
        )}
      </Panel>
    </>
  );
}
