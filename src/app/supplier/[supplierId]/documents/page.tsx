import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { DocumentsPanel } from '@/components/suppliers/documents-panel';
import { DocumentWarnings } from '@/components/suppliers/document-warnings';
import { can } from '@/server/authz';
import { documentRows, documentWarnings, listDocuments } from '@/server/services/documents';
import { loadSupplier } from '../load';

export const metadata: Metadata = { title: 'Documents' };

export default async function SupplierDocumentsPage({ params }: PageProps<'/supplier/[supplierId]/documents'>) {
  const { supplierId } = await params;
  const { actor, supplier: s } = await loadSupplier(supplierId);
  const [docs, canManage] = await Promise.all([listDocuments(actor, supplierId), can(actor, 'supplier.documents.manage', { supplierId })]);
  return (
    <>
      <PageHeader
        eyebrow={s.name}
        title="Documents"
        description="Your insurance and other documents for the shows you supply. Media10 and those shows’ teams can see them. We remind you 30 days before anything expires."
      />
      <DocumentWarnings warnings={documentWarnings(docs)} who="you" />
      <Panel>
        <DocumentsPanel supplierId={supplierId} docs={documentRows(docs)} canManage={canManage} />
      </Panel>
    </>
  );
}
