import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireActor } from '@/server/auth/current';
import { hasOrganiserSupplier } from '@/server/services/suppliers';
import { NewOrganiser } from './new-organiser';

export const metadata: Metadata = { title: 'Media10’s own services' };

export default async function NewOrganiserPage() {
  await requireActor('suppliers.manage');
  if (await hasOrganiserSupplier()) redirect('/admin/suppliers');
  return (
    <>
      <PageHeader
        eyebrow="Suppliers"
        title="Set up Media10’s own services"
        description="For services Media10 sells itself, such as stand cleaning. They’re charged on Media10’s own Stripe account and invoiced in Media10’s name. No supplier login is made."
      />
      <NewOrganiser />
    </>
  );
}
