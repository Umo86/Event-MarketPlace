'use client';

import { useRouter, usePathname } from 'next/navigation';
import { Select } from '@mantine/core';

/** For contacts with more than one stand: each order is for one stand. */
export function StandPicker({ stands, current }: { stands: { standId: string; number: string; company: string }[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (stands.length < 2) return null;
  return (
    <Select
      label="Ordering for"
      data={stands.map((s) => ({ value: s.standId, label: `Stand ${s.number} · ${s.company}` }))}
      value={current}
      onChange={(v) => v && router.push(`${pathname}?stand=${v}`)}
      allowDeselect={false}
      maw={360}
    />
  );
}
