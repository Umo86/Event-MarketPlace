import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, Badge, Group, List, ListItem, SimpleGrid, Stack, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { requireActor } from '@/server/auth/current';
import { getSupplierForMember } from '@/server/services/suppliers';
import { AppError } from '@/server/errors';
import { SUPPLIER_STATUS_COLOUR, SUPPLIER_STATUS_LABEL } from '@/lib/supplier-status';

export const metadata: Metadata = { title: 'Overview' };

/** The supplier's own panel. Orders, payments, refunds and the catalogue arrive in later parts of the build. */
export default async function SupplierOverview({ params }: PageProps<'/supplier/[supplierId]'>) {
  const { supplierId } = await params;
  const { actor } = await requireActor('supplier.view', { supplierId });
  const { supplier: s, role, members } = await getSupplierForMember(actor, supplierId).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });
  return (
    <>
      <PageHeader eyebrow="Supplier panel" title={s.name} description={role === 'owner' ? 'You’re the owner of this supplier account.' : 'You’re on this supplier’s team.'} />
      <Stack gap="lg">
        {s.pausedAt ? (
          <Alert color="red" title="Your account is paused">
            {s.pausedReason} Your services are hidden and you can’t take new orders. Orders already paid are not affected. Contact Media10 about this.
          </Alert>
        ) : null}
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
                {s.stripeChargesEnabled
                  ? 'Your Stripe account is connected and can take payments.'
                  : 'Next: connect your Stripe account, so exhibitors’ payments go straight to you. This button will appear here shortly; Media10 will let you know.'}
              </ListItem>
              <ListItem>Then: add your services and prices for each show you supply.</ListItem>
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
