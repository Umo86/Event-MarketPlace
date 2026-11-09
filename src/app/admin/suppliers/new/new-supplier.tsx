'use client';

import { useState } from 'react';
import { Button, Group, Stack } from '@mantine/core';
import Link from 'next/link';
import { Panel } from '@/components/ui/panel';
import { EMPTY_SUPPLIER, SupplierForm } from '@/components/suppliers/supplier-form';
import { LoginDetailsCard, type LoginDetails } from '@/components/suppliers/login-details';
import { useAction } from '@/lib/use-action';
import { createSupplierAction } from '../actions';

export function NewSupplier() {
  const [done, setDone] = useState<{ id: string; name: string; login: LoginDetails } | null>(null);
  const create = useAction(createSupplierAction, { onSuccess: (d) => d && setDone(d) });
  if (done) {
    return (
      <Stack>
        <LoginDetailsCard login={done.login} supplierName={done.name} />
        <Group>
          <Button component={Link} href={`/admin/suppliers/${done.id}`}>
            Go to {done.name}
          </Button>
          <Button component={Link} href="/admin/suppliers" variant="default">
            Back to suppliers
          </Button>
        </Group>
      </Stack>
    );
  }
  return (
    <Panel>
      <SupplierForm
        mode="create"
        initial={EMPTY_SUPPLIER}
        pending={create.pending}
        errors={create.fieldErrors}
        onSubmit={(v) => create.run(v)}
      />
    </Panel>
  );
}
