import { Anchor, Badge, Group, Stack, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { LinkAnchor } from '@/components/ui/links';
import { dateTime, money } from '@/lib/format';
import { PART_STATUS_COLOUR, PART_STATUS_LABEL } from '@/lib/order-status';

/** Server components for order lists and summaries, shared by show teams and suppliers. */

type Row = {
  id: string;
  orderNumber: string;
  placedAt: Date;
  standNumber: string;
  hallName: string | null;
  companyName: string;
  supplierName: string;
  status: keyof typeof PART_STATUS_LABEL;
  totalPence: number;
  feePence: number;
  feeRefundedPence: number;
  refundedPence: number;
  disputedPence: number;
  invoiceNumber: string | null;
};

export function OrderTable({ rows, hrefFor, showSupplier, showFee }: { rows: Row[]; hrefFor: (id: string) => string; showSupplier: boolean; showFee: boolean }) {
  if (!rows.length) return <Text c="dimmed">No orders yet.</Text>;
  return (
    <TableScrollContainer minWidth={860}>
      <Table fz="sm" verticalSpacing="sm" data-testid="orders-table">
        <TableThead>
          <TableTr>
            <TableTh>Order</TableTh>
            <TableTh>Stand</TableTh>
            {showSupplier ? <TableTh>Supplier</TableTh> : null}
            <TableTh ta="right">Paid</TableTh>
            {showFee ? <TableTh ta="right">Commission</TableTh> : null}
            <TableTh ta="right">Refunded</TableTh>
            <TableTh>Status</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {rows.map((r) => (
            <TableTr key={r.id}>
              <TableTd>
                <LinkAnchor href={hrefFor(r.id)} fw={600}>
                  {r.orderNumber}
                </LinkAnchor>
                <Text fz="xs" c="dimmed">
                  {dateTime(r.placedAt)}
                  {r.invoiceNumber ? ` · ${r.invoiceNumber}` : ''}
                </Text>
              </TableTd>
              <TableTd>
                {r.standNumber}
                {r.hallName ? `, ${r.hallName}` : ''}
                <Text fz="xs" c="dimmed">
                  {r.companyName}
                </Text>
              </TableTd>
              {showSupplier ? <TableTd>{r.supplierName}</TableTd> : null}
              <TableTd ta="right">{money(r.totalPence)}</TableTd>
              {showFee ? <TableTd ta="right">{money(r.feePence - r.feeRefundedPence)}</TableTd> : null}
              <TableTd ta="right">{r.refundedPence ? money(r.refundedPence) : '—'}</TableTd>
              <TableTd>
                <Group gap={4}>
                  <Badge color={PART_STATUS_COLOUR[r.status]}>{PART_STATUS_LABEL[r.status]}</Badge>
                  {r.disputedPence ? <Badge color="red">Disputed</Badge> : null}
                </Group>
              </TableTd>
            </TableTr>
          ))}
        </TableTbody>
      </Table>
    </TableScrollContainer>
  );
}

type Summary = { suppliers: { supplierId: string; supplierName: string; organiser: boolean; orders: number; paidPence: number; vatPence: number; refundedPence: number; commissionPence: number; supplierKeepsPence: number }[]; total: { orders: number; paidPence: number; vatPence: number; refundedPence: number; commissionPence: number; supplierKeepsPence: number } };

export function TakingsTable({ summary }: { summary: Summary }) {
  if (!summary.suppliers.length) return <Text c="dimmed">Nothing paid yet.</Text>;
  return (
    <TableScrollContainer minWidth={760}>
      <Table fz="sm" verticalSpacing="xs" data-testid="takings-table">
        <TableThead>
          <TableTr>
            <TableTh>Supplier</TableTh>
            <TableTh ta="right">Orders</TableTh>
            <TableTh ta="right">Paid (with VAT)</TableTh>
            <TableTh ta="right">Refunded</TableTh>
            <TableTh ta="right">Media10 commission</TableTh>
            <TableTh ta="right">Supplier keeps</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {summary.suppliers.map((s) => (
            <TableTr key={s.supplierId}>
              <TableTd>
                {s.supplierName}
                {s.organiser ? (
                  <Text fz="xs" c="dimmed">
                    Media10’s own: all of it is Media10’s
                  </Text>
                ) : null}
              </TableTd>
              <TableTd ta="right">{s.orders}</TableTd>
              <TableTd ta="right">{money(s.paidPence)}</TableTd>
              <TableTd ta="right">{money(s.refundedPence)}</TableTd>
              <TableTd ta="right">{s.organiser ? '—' : money(s.commissionPence)}</TableTd>
              <TableTd ta="right">{s.organiser ? '—' : money(s.supplierKeepsPence)}</TableTd>
            </TableTr>
          ))}
          <TableTr fw={700}>
            <TableTd>Total</TableTd>
            <TableTd ta="right">{summary.total.orders}</TableTd>
            <TableTd ta="right">{money(summary.total.paidPence)}</TableTd>
            <TableTd ta="right">{money(summary.total.refundedPence)}</TableTd>
            <TableTd ta="right">{money(summary.total.commissionPence)}</TableTd>
            <TableTd ta="right">{money(summary.total.supplierKeepsPence)}</TableTd>
          </TableTr>
        </TableTbody>
      </Table>
    </TableScrollContainer>
  );
}

type Detail = {
  row: Row & { contactName: string; email: string; poNumber: string | null; netPence: number; vatPence: number; invoiceFileId: string | null; paidAt: Date | null; paymentError: string | null; standTypeName: string | null };
  lines: { id: string; description: string; quantity: number; unitPricePence: number; netPence: number; vatPence: number; totalPence: number; refundedPence: number; commissionPence: number }[];
  refunds: { id: string; amountPence: number; reason: string; status: string; source: string; byMedia10: boolean; creditNoteNumber: string | null; creditNoteFileId: string | null; createdAt: Date; error: string | null }[];
};

export function OrderDetail({ d, showFee }: { d: Detail; showFee: boolean }) {
  const r = d.row;
  return (
    <Stack gap="md">
      <Group gap="xl" align="flex-start" wrap="wrap">
        <div>
          <Text fz="xs" c="dimmed">
            Stand
          </Text>
          <Text fw={600}>
            {r.standNumber}
            {r.hallName ? `, ${r.hallName}` : ''}
            {r.standTypeName ? ` · ${r.standTypeName}` : ''}
          </Text>
          <Text fz="sm">{r.companyName}</Text>
          <Text fz="sm" c="dimmed">
            {r.contactName ? `${r.contactName} · ` : ''}
            {r.email}
          </Text>
        </div>
        <div>
          <Text fz="xs" c="dimmed">
            Payment
          </Text>
          <Badge color={PART_STATUS_COLOUR[r.status]}>{PART_STATUS_LABEL[r.status]}</Badge>
          <Text fz="sm">{r.paidAt ? `Paid ${dateTime(r.paidAt)}` : (r.paymentError ?? 'Not paid')}</Text>
          {r.poNumber ? <Text fz="sm">PO {r.poNumber}</Text> : null}
        </div>
        <div>
          <Text fz="xs" c="dimmed">
            Invoice
          </Text>
          {r.invoiceFileId ? (
            <Anchor href={`/files/${r.invoiceFileId}`} className="text-link" fz="sm">
              {r.invoiceNumber}
            </Anchor>
          ) : (
            <Text fz="sm">{r.invoiceNumber ?? '—'}</Text>
          )}
        </div>
      </Group>
      <Table fz="sm" verticalSpacing="xs">
        <TableThead>
          <TableTr>
            <TableTh>Item</TableTh>
            <TableTh ta="right">Qty</TableTh>
            <TableTh ta="right">Unit</TableTh>
            <TableTh ta="right">Before VAT</TableTh>
            <TableTh ta="right">VAT</TableTh>
            {showFee ? <TableTh ta="right">Commission</TableTh> : null}
            <TableTh ta="right">Refunded</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {d.lines.map((l) => (
            <TableTr key={l.id}>
              <TableTd>{l.description}</TableTd>
              <TableTd ta="right">{l.quantity}</TableTd>
              <TableTd ta="right">{money(l.unitPricePence)}</TableTd>
              <TableTd ta="right">{money(l.netPence)}</TableTd>
              <TableTd ta="right">{money(l.vatPence)}</TableTd>
              {showFee ? <TableTd ta="right">{money(l.commissionPence)}</TableTd> : null}
              <TableTd ta="right">{l.refundedPence ? money(l.refundedPence) : '—'}</TableTd>
            </TableTr>
          ))}
        </TableTbody>
      </Table>
      <Stack gap={0} align="flex-end">
        <Text fz="sm">
          Before VAT {money(r.netPence)} · VAT {money(r.vatPence)}
        </Text>
        <Text fw={700}>Total {money(r.totalPence)}</Text>
        {showFee ? (
          <Text fz="sm" c="dimmed">
            Media10 commission {money(r.feePence)}
            {r.feeRefundedPence ? `, ${money(r.feeRefundedPence)} returned on refunds` : ''}
          </Text>
        ) : null}
      </Stack>
      {d.refunds.length ? (
        <Stack gap={4}>
          <Text fw={650}>Refunds</Text>
          {d.refunds.map((x) => (
            <Text key={x.id} fz="sm">
              {dateTime(x.createdAt)} · {money(x.amountPence)} · {x.status === 'succeeded' ? 'done' : x.status === 'pending' ? 'going through' : `failed${x.error ? `: ${x.error}` : ''}`}
              {x.byMedia10 ? ' · by Media10' : x.source === 'stripe' ? ' · in Stripe' : ''} · {x.reason}
              {x.creditNoteFileId ? (
                <>
                  {' · '}
                  <Anchor href={`/files/${x.creditNoteFileId}`} className="text-link" fz="sm">
                    {x.creditNoteNumber}
                  </Anchor>
                </>
              ) : x.creditNoteNumber ? (
                ` · ${x.creditNoteNumber}`
              ) : null}
            </Text>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}
