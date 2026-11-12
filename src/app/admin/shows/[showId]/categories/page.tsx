import type { Metadata } from 'next';
import { Badge, Group, Stack, Text } from '@mantine/core';
import { Panel } from '@/components/ui/panel';
import { DocumentsPanel } from '@/components/suppliers/documents-panel';
import { can } from '@/server/authz';
import { assignableSuppliers, listCategories } from '@/server/services/categories';
import { documentRows, documentWarnings, hasInsurance, listDocuments } from '@/server/services/documents';
import { loadShow } from '../load';
import { CategoryManager } from './category-manager';

export const metadata: Metadata = { title: 'Categories' };

/**
 * What exhibitors can order, by category, and the one supplier that serves each. Below, the
 * documents of every supplier on the show, so the team can check their insurance.
 */
export default async function CategoriesPage({ params }: PageProps<'/admin/shows/[showId]/categories'>) {
  const { showId } = await params;
  const { actor, show } = await loadShow(showId);
  const [categories, canManage] = await Promise.all([listCategories(actor, show.id), can(actor, 'categories.manage', { showId })]);
  const suppliers = canManage ? await assignableSuppliers(actor, show.id) : [];
  const onShow = [...new Map(categories.filter((c) => c.supplier && c.supplier.kind === 'company').map((c) => [c.supplier!.id, c.supplier!])).values()];
  const docs = await Promise.all(onShow.map(async (s) => ({ supplier: s, docs: await listDocuments(actor, s.id) })));
  return (
    <Stack gap="lg">
      <Panel
        title="Categories"
        description="Each category has one supplier for this show. Exhibitors see a category once its supplier is ready to sell. Media10’s own services, such as cleaning, use Media10 as the supplier."
      >
        <CategoryManager showId={show.id} categories={categories} suppliers={suppliers} canManage={canManage} />
      </Panel>
      {docs.length ? (
        <Panel title="Suppliers’ documents" description="Insurance and other documents from this show’s suppliers. Show admins are emailed 30 days before anything expires.">
          <Stack gap="xl">
            {docs.map(({ supplier, docs: d }) => (
              <Stack key={supplier.id} gap="xs">
                <Group gap="xs">
                  <Text fw={650}>{supplier.name}</Text>
                  {hasInsurance(d) ? null : <Badge color="red">No public liability insurance in date</Badge>}
                  {documentWarnings(d).length ? <Badge color="yellow">Something expires soon</Badge> : null}
                </Group>
                <DocumentsPanel supplierId={supplier.id} docs={documentRows(d)} canManage={false} />
              </Stack>
            ))}
          </Stack>
        </Panel>
      ) : null}
    </Stack>
  );
}
