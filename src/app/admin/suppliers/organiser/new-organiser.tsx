'use client';

import { useRouter } from 'next/navigation';
import { Panel } from '@/components/ui/panel';
import { EMPTY_SUPPLIER, SupplierForm } from '@/components/suppliers/supplier-form';
import { useAction } from '@/lib/use-action';
import { createOrganiserSupplierAction } from '../actions';

export function NewOrganiser() {
  const router = useRouter();
  const create = useAction(createOrganiserSupplierAction, { successMessage: 'Set up.', onSuccess: (d) => d && router.push(`/admin/suppliers/${d.id}`) });
  return (
    <Panel>
      <SupplierForm mode="organiser" initial={{ ...EMPTY_SUPPLIER, name: 'Media10 Ltd', invoicePrefix: 'M10' }} pending={create.pending} errors={create.fieldErrors} onSubmit={(v) => create.run(v)} />
    </Panel>
  );
}
