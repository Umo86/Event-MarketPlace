import type { Metadata } from 'next';
import { Badge, Paper, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { LinkAnchor, LinkButton } from '@/components/ui/links';
import { requireActor } from '@/server/auth/current';
import { listSuppliers } from '@/server/services/suppliers';
import { SUPPLIER_STATUS_COLOUR, SUPPLIER_STATUS_LABEL } from '@/lib/supplier-status';

export const metadata: Metadata = { title: 'Suppliers' };

export default async function SuppliersPage() {
  const { actor } = await requireActor('suppliers.view');
  const rows = await listSuppliers(actor);
  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Companies exhibitors order from. Suppliers work across shows. You make each one’s login and pass it on yourself."
        actions={
          <LinkButton href="/admin/suppliers/new" leftSection={<IconPlus size={16} />}>
            Add supplier
          </LinkButton>
        }
      />
      <Paper withBorder radius="md" p="lg" style={{ borderColor: 'var(--em-line)' }}>
        {rows.length ? (
          <TableScrollContainer minWidth={640}>
            <Table verticalSpacing="sm" fz="sm" highlightOnHover>
              <TableThead>
                <TableTr>
                  <TableTh>Supplier</TableTh>
                  <TableTh>Main contact</TableTh>
                  <TableTh>Invoice prefix</TableTh>
                  <TableTh>Status</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {rows.map((s) => (
                  <TableTr key={s.id}>
                    <TableTd>
                      <LinkAnchor href={`/admin/suppliers/${s.id}`} fw={600}>
                        {s.name}
                      </LinkAnchor>
                    </TableTd>
                    <TableTd>
                      {s.contactName}
                      <Text fz="xs" c="dimmed">
                        {s.email}
                      </Text>
                    </TableTd>
                    <TableTd>{s.invoicePrefix}</TableTd>
                    <TableTd>
                      <Badge color={SUPPLIER_STATUS_COLOUR[s.status]}>{SUPPLIER_STATUS_LABEL[s.status]}</Badge>
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </TableScrollContainer>
        ) : (
          <Text c="dimmed">No suppliers yet. Add the first one to make their login.</Text>
        )}
      </Paper>
    </>
  );
}
