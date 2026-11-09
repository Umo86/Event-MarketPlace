'use client';

import { useState } from 'react';
import { Button, Checkbox, Divider, Group, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { suggestPrefix } from '@/lib/supplier-status';

export type SupplierValues = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postcode: string;
  vatRegistered: boolean;
  vatNumber: string;
  invoicePrefix: string;
};

export const EMPTY_SUPPLIER: SupplierValues = { name: '', contactName: '', email: '', phone: '', addressLine1: '', addressLine2: '', city: '', postcode: '', vatRegistered: true, vatNumber: '', invoicePrefix: '' };

/** The supplier's company details. On a new supplier, the email becomes their login. */
export function SupplierForm({ initial, mode, onSubmit, pending, errors }: { initial: SupplierValues; mode: 'create' | 'edit'; onSubmit: (v: SupplierValues) => void; pending: boolean; errors: Record<string, string> }) {
  const [v, setV] = useState(initial);
  const [prefixTouched, setPrefixTouched] = useState(mode === 'edit');
  const set = (k: keyof SupplierValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    setV((old) => ({ ...old, [k]: value, ...(k === 'name' && !prefixTouched ? { invoicePrefix: suggestPrefix(value) } : {}) }));
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <Stack gap="lg" maw={720}>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Company name" required value={v.name} onChange={set('name')} error={errors.name} />
          <TextInput label="Main contact’s name" required value={v.contactName} onChange={set('contactName')} error={errors.contactName} />
          {mode === 'create' ? (
            <TextInput label="Main contact’s email" description="This becomes their login." type="email" required value={v.email} onChange={set('email')} error={errors.email} />
          ) : null}
          <TextInput label="Phone" value={v.phone} onChange={set('phone')} error={errors.phone} />
        </SimpleGrid>
        <Divider />
        <div>
          <Text fw={650}>For their invoices</Text>
          <Text fz="sm" c="dimmed">
            Each order gets a VAT invoice in the supplier’s name, so these appear on it.
          </Text>
        </div>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Address" value={v.addressLine1} onChange={set('addressLine1')} />
          <TextInput label="Address line 2" value={v.addressLine2} onChange={set('addressLine2')} />
          <TextInput label="Town or city" value={v.city} onChange={set('city')} />
          <TextInput label="Postcode" value={v.postcode} onChange={set('postcode')} />
        </SimpleGrid>
        <Checkbox label="VAT registered" checked={v.vatRegistered} onChange={(e) => setV({ ...v, vatRegistered: e.currentTarget.checked })} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {v.vatRegistered ? <TextInput label="VAT number (optional)" placeholder="GB123456789" value={v.vatNumber} onChange={set('vatNumber')} error={errors.vatNumber} /> : <div />}
          <TextInput
            label="Invoice prefix"
            description="Starts their invoice numbers, e.g. SE-INV-000001."
            required
            maxLength={6}
            value={v.invoicePrefix}
            onChange={(e) => {
              setPrefixTouched(true);
              setV({ ...v, invoicePrefix: e.currentTarget.value.toUpperCase() });
            }}
            error={errors.invoicePrefix}
          />
        </SimpleGrid>
        <Group>
          <Button type="submit" loading={pending}>
            {mode === 'create' ? 'Add supplier and make their login' : 'Save details'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
