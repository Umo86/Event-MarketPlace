import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { ProductEditor } from '@/components/catalogue/product-editor';
import { can } from '@/server/authz';
import { editorProducts, supplierCatalogue } from '@/server/services/catalogue';
import { AppError } from '@/server/errors';
import { loadSupplier } from '../../load';

export const metadata: Metadata = { title: 'Catalogue' };

export default async function SupplierShowCataloguePage({ params }: PageProps<'/supplier/[supplierId]/catalogue/[showId]'>) {
  const { supplierId, showId } = await params;
  const { actor, supplier: s } = await loadSupplier(supplierId);
  const cat = await supplierCatalogue(actor, supplierId, showId).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });
  const canEdit = await can(actor, 'supplier.catalogue.edit', { supplierId });
  return (
    <>
      <PageHeader eyebrow={s.name} title={cat.show.name} description="Prices are before VAT. Exhibitors see the early-bird and late prices on the show’s dates." />
      <Stack gap="lg">
        {s.status !== 'ready' ? <Alert color="yellow">Exhibitors can’t see your products until you’re ready to sell (connect Stripe on the Payments page).</Alert> : null}
        <ProductEditor products={editorProducts(cat.products)} categories={cat.categories} standTypes={cat.standTypes} showId={showId} supplierId={supplierId} via="supplier" canEdit={canEdit} />
      </Stack>
    </>
  );
}
