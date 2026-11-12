'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Group, NumberInput, Stack, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { placeOrderAction, setQuantityAction } from '@/app/[show]/shop-actions';

export function QuantityControl({ slug, standId, productId, name, quantity }: { slug: string; standId: string; productId: string; name: string; quantity: number }) {
  const [qty, setQty] = useState(quantity);
  const save = useAction(setQuantityAction);
  return (
    <Group gap={6} wrap="nowrap" justify="flex-end">
      <NumberInput aria-label={`Quantity of ${name}`} min={0} max={999} value={qty} onChange={(v) => setQty(typeof v === 'number' ? v : 0)} w={80} size="xs" />
      {qty !== quantity ? (
        <Button size="xs" variant="default" loading={save.pending} onClick={() => save.run({ slug, standId, productId, quantity: qty })}>
          Update
        </Button>
      ) : null}
      <Button size="xs" variant="subtle" color="red" loading={save.pending} onClick={() => save.run({ slug, standId, productId, quantity: 0 })} aria-label={`Remove ${name}`}>
        Remove
      </Button>
    </Group>
  );
}

export function RemoveUnavailable({ slug, standId, productId, name }: { slug: string; standId: string; productId: string; name: string }) {
  const save = useAction(setQuantityAction);
  return (
    <Button size="xs" variant="default" loading={save.pending} onClick={() => save.run({ slug, standId, productId, quantity: 0 })} aria-label={`Take ${name} out of your basket`}>
      Take it out
    </Button>
  );
}

/** PO number and "Place order and pay". */
export function PlaceOrder({ slug, standId, disabled }: { slug: string; standId: string; disabled: boolean }) {
  const router = useRouter();
  const [po, setPo] = useState('');
  const place = useAction(placeOrderAction, { onSuccess: (d) => d && router.push(`/${slug}/orders/${d.orderId}/pay`) });
  return (
    <Stack gap="sm">
      <TextInput label="Your purchase order number (optional)" description="It goes on every supplier’s invoice." value={po} onChange={(e) => setPo(e.currentTarget.value)} maw={360} maxLength={60} />
      <Group>
        <Button size="md" onClick={() => place.run({ slug, standId, poNumber: po || null })} loading={place.pending} disabled={disabled}>
          Place order and pay
        </Button>
      </Group>
    </Stack>
  );
}
