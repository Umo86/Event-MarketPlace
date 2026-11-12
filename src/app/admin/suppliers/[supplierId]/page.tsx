import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, Badge, Group, Stack, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { requireActor } from '@/server/auth/current';
import { getSupplierForAdmin } from '@/server/services/suppliers';
import { AppError } from '@/server/errors';
import { ORGANISER_HELP, SUPPLIER_STATUS_COLOUR, SUPPLIER_STATUS_HELP, SUPPLIER_STATUS_LABEL } from '@/lib/supplier-status';
import { dateTime } from '@/lib/format';
import { DocumentsPanel } from '@/components/suppliers/documents-panel';
import { DocumentWarnings } from '@/components/suppliers/document-warnings';
import { LinkAnchor } from '@/components/ui/links';
import { connectViewForAdmin } from '@/server/services/connect';
import { showsForSupplier } from '@/server/services/categories';
import { documentRows, documentWarnings, listDocuments } from '@/server/services/documents';
import { SupplierAdminControls } from './supplier-controls';
import { AdminCheckStripe } from './check-stripe';

export const metadata: Metadata = { title: 'Supplier' };

export default async function SupplierPage({ params }: PageProps<'/admin/suppliers/[supplierId]'>) {
  const { supplierId } = await params;
  const { actor } = await requireActor('suppliers.view');
  const found = await getSupplierForAdmin(actor, supplierId).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });
  const { supplier: s, members } = found;
  const organiser = s.kind === 'organiser';
  const [connect, served, docs] = await Promise.all([connectViewForAdmin(actor, s.id), showsForSupplier(actor, s.id, 'suppliers.view'), listDocuments(actor, s.id)]);
  return (
    <>
      <PageHeader eyebrow={organiser ? 'Media10’s own services' : 'Suppliers'} title={s.name} description={`${s.contactName} · ${s.email}${s.phone ? ` · ${s.phone}` : ''}`} />
      <DocumentWarnings warnings={documentWarnings(docs)} who="they" />
      <Stack gap="lg">
        <Panel title="Status">
          <Group gap="sm">
            <Badge color={SUPPLIER_STATUS_COLOUR[s.status]} size="lg">
              {SUPPLIER_STATUS_LABEL[s.status]}
            </Badge>
            <Text fz="sm">{organiser && s.status === 'ready' ? ORGANISER_HELP : SUPPLIER_STATUS_HELP[s.status]}</Text>
          </Group>
          {s.pausedAt ? (
            <Alert color="red" title={`Paused on ${dateTime(s.pausedAt)}`}>
              {s.pausedReason}
            </Alert>
          ) : null}
          {organiser ? null : (
            <Group gap="sm" justify="space-between">
              <Text fz="sm" c="dimmed">
                Stripe:{' '}
                {s.stripeAccountId
                  ? `connected as ${s.stripeAccountId} · ${s.stripeChargesEnabled ? 'can take payments' : 'Stripe still needs details from them'} · payouts ${s.stripePayoutsEnabled ? 'on' : 'not on yet'}${connect.checkedAt ? ` · checked ${dateTime(connect.checkedAt)}` : ''}`
                  : 'not connected yet. Their owner connects it from the Payments page of their panel.'}
                {connect.mode === 'simulator' ? ' (payment simulator)' : connect.testMode ? ' (Stripe test mode)' : ''}
              </Text>
              {s.stripeAccountId && connect.mode === 'stripe' ? <AdminCheckStripe supplierId={s.id} /> : null}
            </Group>
          )}
        </Panel>
        <Panel title="Shows" description="Show admins choose which supplier serves each category, on the show’s Categories page.">
          {served.length ? (
            <Stack gap={6}>
              {served.map((sh) => (
                <Text key={sh.id} fz="sm">
                  <LinkAnchor href={`/admin/shows/${sh.id}/categories`} fw={600}>
                    {sh.name}
                  </LinkAnchor>
                  {` · ${sh.categories.join(', ')}`}
                </Text>
              ))}
            </Stack>
          ) : (
            <Text fz="sm" c="dimmed">
              Not supplying any shows yet.
            </Text>
          )}
        </Panel>
        <Panel title="Documents" description="Insurance and other documents. The supplier and the admins of the shows they supply are reminded 30 days before anything expires.">
          <DocumentsPanel supplierId={s.id} docs={documentRows(docs)} canManage />
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
