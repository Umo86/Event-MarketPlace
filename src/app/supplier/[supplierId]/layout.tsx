import { Stack } from '@mantine/core';
import { LinkTabs } from '@/components/ui/link-tabs';
import { loadSupplier } from './load';

/** Every page of a supplier's panel, with its sections. */
export default async function SupplierPanelLayout({ children, params }: LayoutProps<'/supplier/[supplierId]'>) {
  const { supplierId } = await params;
  const { supplier } = await loadSupplier(supplierId);
  const base = `/supplier/${supplierId}`;
  const tabs = [
    { label: 'Overview', href: base, exact: true },
    { label: 'Orders', href: `${base}/orders` },
    { label: 'Catalogue', href: `${base}/catalogue` },
    ...(supplier.kind === 'company' ? [{ label: 'Payments', href: `${base}/payments` }] : []),
    { label: 'Documents', href: `${base}/documents` },
  ];
  return (
    <Stack gap="lg">
      <LinkTabs tabs={tabs} label="Supplier panel sections" />
      <div>{children}</div>
    </Stack>
  );
}
