import type { Metadata } from 'next';
import { Badge, Group, Paper, SimpleGrid, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { LinkAnchor } from '@/components/ui/links';
import { requireSignedIn } from '@/server/auth/current';
import { mySuppliers } from '@/server/services/suppliers';
import { SUPPLIER_STATUS_COLOUR, SUPPLIER_STATUS_LABEL } from '@/lib/supplier-status';

export const metadata: Metadata = { title: 'Your suppliers' };

export default async function SupplierChooser() {
  const actor = await requireSignedIn();
  const rows = await mySuppliers(actor);
  return (
    <>
      <PageHeader title="Your suppliers" description="You sign in for more than one supplier. Choose which to work on." />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {rows.map((s) => (
          <Paper key={s.id} withBorder radius="md" p="lg" style={{ borderColor: 'var(--em-line)' }}>
            <Group justify="space-between">
              <LinkAnchor href={`/supplier/${s.id}`} fw={650}>
                {s.name}
              </LinkAnchor>
              <Badge color={SUPPLIER_STATUS_COLOUR[s.status]}>{SUPPLIER_STATUS_LABEL[s.status]}</Badge>
            </Group>
          </Paper>
        ))}
      </SimpleGrid>
      {!rows.length ? <Text c="dimmed">Your login isn’t linked to a supplier. Contact Media10.</Text> : null}
    </>
  );
}
