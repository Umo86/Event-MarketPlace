import type { Metadata } from 'next';
import { Alert, Badge, Group, List, ListItem, SimpleGrid, Stack, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { LinkAnchor } from '@/components/ui/links';
import { DocumentWarnings } from '@/components/suppliers/document-warnings';
import { showsForSupplier } from '@/server/services/categories';
import { documentWarnings, hasInsurance, listDocuments } from '@/server/services/documents';
import { SUPPLIER_STATUS_COLOUR, SUPPLIER_STATUS_LABEL } from '@/lib/supplier-status';
import { dateTime } from '@/lib/format';
import { loadSupplier } from './load';

export const metadata: Metadata = { title: 'Overview' };

/** The supplier's own panel. Orders, refunds and the catalogue arrive in later parts of the build. */
export default async function SupplierOverview({ params }: PageProps<'/supplier/[supplierId]'>) {
  const { supplierId } = await params;
  const { actor, supplier: s, role, members } = await loadSupplier(supplierId);
  const [served, docs] = await Promise.all([showsForSupplier(actor, supplierId, 'supplier.view'), listDocuments(actor, supplierId)]);
  return (
    <>
      <PageHeader eyebrow="Supplier panel" title={s.name} description={role === 'owner' ? 'You’re the owner of this supplier account.' : 'You’re on this supplier’s team.'} />
      <Stack gap="lg">
        {s.pausedAt ? (
          <Alert color="red" title="Your account is paused">
            {s.pausedReason} Your services are hidden and you can’t take new orders. Orders already paid are not affected. Contact Media10 about this.
          </Alert>
        ) : null}
        <DocumentWarnings warnings={documentWarnings(docs)} who="you" />
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Panel title="Where you are">
            <Group gap="sm">
              <Badge color={SUPPLIER_STATUS_COLOUR[s.status]} size="lg">
                {SUPPLIER_STATUS_LABEL[s.status]}
              </Badge>
            </Group>
            <List spacing="xs" fz="sm">
              <ListItem>Your login is set up.</ListItem>
              <ListItem>
                {s.stripeChargesEnabled ? (
                  'Your Stripe account is connected and can take payments.'
                ) : (
                  <>
                    Next: <LinkAnchor href={`/supplier/${supplierId}/payments`}>connect your Stripe account</LinkAnchor>, so exhibitors’ payments go straight to you.
                  </>
                )}
              </ListItem>
              <ListItem>
                {hasInsurance(docs) ? (
                  'Your public liability insurance is uploaded.'
                ) : (
                  <>
                    <LinkAnchor href={`/supplier/${supplierId}/documents`}>Upload your public liability insurance</LinkAnchor>, with its expiry date.
                  </>
                )}
              </ListItem>
              <ListItem>Then: add your services and prices for each show you supply. That part opens soon.</ListItem>
            </List>
          </Panel>
          <Panel title="Your details" description="These appear on the VAT invoices exhibitors receive. If anything is wrong, tell Media10.">
            <Stack gap={4}>
              <Text fz="sm">{s.name}</Text>
              {[s.addressLine1, s.addressLine2, s.city, s.postcode].filter(Boolean).length ? (
                <Text fz="sm" c="dimmed">
                  {[s.addressLine1, s.addressLine2, s.city, s.postcode].filter(Boolean).join(', ')}
                </Text>
              ) : (
                <Text fz="sm" c="dimmed">
                  No address yet
                </Text>
              )}
              <Text fz="sm" c="dimmed">
                {s.vatRegistered ? `VAT registered${s.vatNumber ? `: ${s.vatNumber}` : ' (number to be added)'}` : 'Not VAT registered'}
              </Text>
              <Text fz="sm" c="dimmed">
                Invoice numbers start {s.invoicePrefix}-INV-
              </Text>
            </Stack>
          </Panel>
        </SimpleGrid>
        <Panel title="Your shows" description="The shows Media10 has chosen you to supply, and what for.">
          {served.length ? (
            <Stack gap="sm" data-testid="supplier-shows">
              {served.map((sh) => (
                <div key={sh.id}>
                  <Text fz="sm" fw={600}>
                    {sh.name}
                  </Text>
                  <Text fz="sm" c="dimmed">
                    {sh.categories.join(', ')}
                    {sh.closesAt ? ` · ordering closes ${dateTime(sh.closesAt)}` : ''}
                  </Text>
                </div>
              ))}
            </Stack>
          ) : (
            <Text fz="sm" c="dimmed">
              No shows yet. Media10 will add you to the shows you supply.
            </Text>
          )}
        </Panel>
        <Panel title="Your team">
          <Stack gap={6}>
            {members.map((m) => (
              <Group key={m.userId} gap="xs">
                <Text fz="sm" fw={600}>
                  {m.name || m.email}
                </Text>
                <Text fz="sm" c="dimmed">
                  {m.email}
                </Text>
                <Badge color={m.role === 'owner' ? 'market' : 'gray'}>{m.role === 'owner' ? 'Owner' : 'Staff'}</Badge>
              </Group>
            ))}
          </Stack>
        </Panel>
      </Stack>
    </>
  );
}
