'use client';

import { useState } from 'react';
import { Button, Group, NumberInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { setQuantityAction } from '@/app/[show]/shop-actions';

/** Quantity and "Add to basket" (or "Update basket" when it's already in). */
export function AddToBasket({ slug, standId, productId, name, inBasket, max, disabled }: { slug: string; standId: string; productId: string; name: string; inBasket: number; max: number | null; disabled?: boolean }) {
  const [qty, setQty] = useState<number>(inBasket || 1);
  const save = useAction(setQuantityAction, { successMessage: inBasket ? 'Basket updated.' : `${name} added to your basket.` });
  return (
    <Group gap="xs" wrap="nowrap">
      <NumberInput aria-label={`How many ${name}`} min={inBasket ? 0 : 1} max={max ?? 999} value={qty} onChange={(v) => setQty(typeof v === 'number' ? v : 1)} w={90} disabled={disabled} />
      <Button onClick={() => save.run({ slug, standId, productId, quantity: qty })} loading={save.pending} disabled={disabled}>
        {inBasket ? 'Update basket' : 'Add to basket'}
      </Button>
    </Group>
  );
}
