'use client';

import { useState } from 'react';
import { Button, Group, SegmentedControl, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, TextInput, Textarea } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { money } from '@/lib/format';
import { parsePounds } from '@/lib/pricing';
import { refundAction } from '@/app/refund-actions';

type Line = { id: string; description: string; quantity: number; leftPence: number };

/** Refund a whole line, part of one, or an amount spread across what's left. */
export function RefundForm({ supplierOrderId, lines, via, onBehalf }: { supplierOrderId: string; lines: Line[]; via: 'supplier' | 'show'; onBehalf?: string }) {
  const [mode, setMode] = useState<'lines' | 'amount'>('lines');
  const [values, setValues] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const refund = useAction(refundAction, {
    onSuccess: () => {
      setOpen(false);
      setValues({});
      setAmount('');
      setReason('');
    },
  });
  const left = lines.reduce((a, l) => a + l.leftPence, 0);
  if (left <= 0) return <Text fz="sm" c="dimmed">Fully refunded.</Text>;
  if (!open) {
    return (
      <Group>
        <Button variant="default" onClick={() => setOpen(true)}>
          Refund…
        </Button>
      </Group>
    );
  }
  const lineAmounts = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, parsePounds(v) ?? 0]).filter(([, v]) => (v as number) > 0));
  const total = mode === 'lines' ? Object.values(lineAmounts).reduce((a: number, b) => a + (b as number), 0) : (parsePounds(amount) ?? 0);
  return (
    <Stack gap="sm">
      {onBehalf ? <Text fz="sm">You’re refunding on {onBehalf}’s behalf. It comes from their Stripe account, Media10’s commission on it is returned, and they’re emailed your reason.</Text> : null}
      <SegmentedControl value={mode} onChange={(v) => setMode(v as 'lines' | 'amount')} data={[{ value: 'lines', label: 'By line' }, { value: 'amount', label: 'An amount' }]} w={260} />
      {mode === 'lines' ? (
        <Table fz="sm">
          <TableThead>
            <TableTr>
              <TableTh>Line</TableTh>
              <TableTh ta="right">Left to refund</TableTh>
              <TableTh ta="right">Refund (£)</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {lines.map((l) => (
              <TableTr key={l.id}>
                <TableTd>
                  {l.description} × {l.quantity}
                </TableTd>
                <TableTd ta="right">{money(l.leftPence)}</TableTd>
                <TableTd ta="right">
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <TextInput aria-label={`Refund on ${l.description}`} value={values[l.id] ?? ''} onChange={(e) => setValues({ ...values, [l.id]: e.currentTarget.value })} w={100} inputMode="decimal" disabled={l.leftPence <= 0} />
                    <Button size="xs" variant="subtle" onClick={() => setValues({ ...values, [l.id]: (l.leftPence / 100).toFixed(2) })} disabled={l.leftPence <= 0}>
                      All
                    </Button>
                  </Group>
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      ) : (
        <TextInput label={`Amount (up to ${money(left)})`} value={amount} onChange={(e) => setAmount(e.currentTarget.value)} inputMode="decimal" w={200} error={refund.fieldErrors.amountPence} />
      )}
      <Textarea label="Reason" description="The exhibitor sees this on their credit note." value={reason} onChange={(e) => setReason(e.currentTarget.value)} autosize minRows={2} error={refund.fieldErrors.reason} />
      <Group>
        <Button color="red" disabled={total <= 0} loading={refund.pending} onClick={() => refund.run({ supplierOrderId, via, reason, ...(mode === 'lines' ? { lineAmounts } : { amountPence: total }) })}>
          Refund {money(total)}
        </Button>
        <Button variant="default" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </Group>
    </Stack>
  );
}
