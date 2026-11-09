import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { requireActor } from '@/server/auth/current';
import { NewSupplier } from './new-supplier';

export const metadata: Metadata = { title: 'Add supplier' };

export default async function NewSupplierPage() {
  await requireActor('suppliers.manage');
  return (
    <>
      <PageHeader eyebrow="Suppliers" title="Add a supplier" description="This makes the supplier and a login for their main contact. You’ll see the login details once, to pass on yourself. No email is sent." />
      <NewSupplier />
    </>
  );
}
