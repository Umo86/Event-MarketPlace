import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, Badge, Group, Stack, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { requireActor } from '@/server/auth/current';
import { getSupplierForAdmin } from '@/server/services/suppliers';
import { AppError } from '@/server/errors';
import { SUPPLIER_STATUS_COLOUR, SUPPLIER_STATUS_HELP, SUPPLIER_STATUS_LABEL } from '@/lib/supplier-status';
import { dateTime } from '@/lib/format';
import { SupplierAdminControls } from './supplier-controls';

export const metadata: Metadata = { title: 'Supplier' };

export default async function SupplierPage({ params }: PageProps<'/admin/suppliers/[supplierId]'>) {
  const { supplierId } = await params;
  const { actor } = await requireActor('suppliers.view');
  const found = await getSupplierForAdmin(actor, supplierId).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });
  const { supplier: s, members } = found;
  return (
    <>
      <PageHeader eyebrow="Suppliers" title={s.name} description={`${s.contactName} · ${s.email}${s.phone ? ` · ${s.phone}` : ''}`} />
      <Stack gap="lg">
        <Panel title="Status">
          <Group gap="sm">
            <Badge color={SUPPLIER_STATUS_COLOUR[s.status]} size="lg">
              {SUPPLIER_STATUS_LABEL[s.status]}
            </Badge>
            <Text fz="sm">{SUPPLIER_STATUS_HELP[s.status]}</Text>
          </Group>
          {s.pausedAt ? (
            <Alert color="red" title={`Paused on ${dateTime(s.pausedAt)}`}>
              {s.pausedReason}
            </Alert>
          ) : null}
          <Text fz="sm" c="dimmed">
            Stripe: {s.stripeAccountId ? `connected (${s.stripeChargesEnabled ? 'can take payments' : 'Stripe still needs details from them'})` : 'not connected yet. They connect it themselves from their panel once that part is built.'}
          </Text>
        </Panel>
        <SupplierAdminControls
          supplierId={s.id}
          supplierName={s.name}
          paused={Boolean(s.pausedAt)}
          details={{
            name: s.name,
            contactName: s.contactName,
            email: s.email,
            phone: s.phone ?? '',
            addressLine1: s.addressLine1 ?? '',
            addressLine2: s.addressLine2 ?? '',
            city: s.city ?? '',
            postcode: s.postcode ?? '',
            vatRegistered: s.vatRegistered,
            vatNumber: s.vatNumber ?? '',
            invoicePrefix: s.invoicePrefix,
          }}
          members={members.map((m) => ({
            userId: m.userId,
            name: m.name,
            email: m.email,
            role: m.role,
            signedIn: m.lastLoginAt ? dateTime(m.lastLoginAt) : null,
            mustChangePassword: m.mustChangePassword,
            twoFactor: Boolean(m.twoFactor),
          }))}
        />
      </Stack>
    </>
  );
}
