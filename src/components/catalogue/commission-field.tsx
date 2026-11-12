'use client';

import { useState } from 'react';
import { Button, Group, Select, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { poundsInput } from '@/lib/pricing';
import { setDefaultCommissionAction, setShowCommissionAction, setSupplierCommissionAction } from '@/app/catalogue-actions';

export type CommissionTarget =
  | { kind: 'show'; showId: string; level: 'show' | 'category' | 'product'; id?: string }
  | { kind: 'supplier'; supplierId: string }
  | { kind: 'platform' };

const NONE = 'none';

/** Commission as a percentage or a fixed amount per line; "Use the default" clears it (not for the platform). */
export function CommissionField({ target, type, value, label, fallbackLabel }: { target: CommissionTarget; type: 'percent' | 'fixed' | null; value: number | null; label: string; fallbackLabel?: string }) {
  const [t, setT] = useState<string>(type ?? NONE);
  const [v, setV] = useState(type === 'percent' && value !== null ? String(value / 100) : type === 'fixed' ? poundsInput(value) : '');
  const show = useAction(setShowCommissionAction);
  const supplier = useAction(setSupplierCommissionAction);
  const platform = useAction(setDefaultCommissionAction);
  const busy = show.pending || supplier.pending || platform.pending;
  const errors = { ...show.fieldErrors, ...supplier.fieldErrors, ...platform.fieldErrors };
  const options = [
    ...(target.kind === 'platform' ? [] : [{ value: NONE, label: fallbackLabel ?? 'Use the default' }]),
    { value: 'percent', label: 'Percentage' },
    { value: 'fixed', label: 'Fixed amount per line' },
  ];
  function save() {
    const commission = { type: t === NONE ? null : (t as 'percent' | 'fixed'), value: v };
    if (target.kind === 'show') show.run({ showId: target.showId, level: target.level, id: target.id ?? null, commission });
    else if (target.kind === 'supplier') supplier.run({ supplierId: target.supplierId, commission });
    else platform.run({ commission });
  }
  return (
    <Group align="flex-end" gap="xs" wrap="wrap">
      <Select label={label} data={options} value={t} onChange={(x) => setT(x ?? NONE)} allowDeselect={false} w={210} />
      {t !== NONE ? (
        <TextInput
          label={t === 'percent' ? 'Percent' : 'Pounds per line'}
          aria-label={`${label}: ${t === 'percent' ? 'percent' : 'pounds per line'}`}
          value={v}
          onChange={(e) => setV(e.currentTarget.value)}
          inputMode="decimal"
          w={130}
          rightSection={t === 'percent' ? '%' : '£'}
          error={errors['commission.value'] ?? errors.value}
        />
      ) : null}
      <Button variant="default" onClick={save} loading={busy}>
        Save
      </Button>
    </Group>
  );
}
