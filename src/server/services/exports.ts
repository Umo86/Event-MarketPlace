import 'server-only';
import { linesFor, type OrderRow } from './reports';
import { toCsv, poundsCell } from '@/lib/csv';
import { spreadsheetDateTime } from '@/lib/format';

/** One row per order line, with the order, stand, seller and money, for finance and suppliers. */
export async function ordersCsv(rows: OrderRow[], opts: { withCommission: boolean }) {
  const lines = await linesFor(rows.map((r) => r.id));
  const byPart = new Map(rows.map((r) => [r.id, r]));
  const header = [
    'Order',
    'Placed',
    'Paid',
    'Status',
    'Supplier',
    'Invoice',
    'Stand',
    'Hall',
    'Stand type',
    'Company',
    'Contact',
    'Email',
    'PO number',
    'Item',
    'Code',
    'Quantity',
    'Unit price',
    'Before VAT',
    'VAT',
    'Total',
    ...(opts.withCommission ? ['Commission'] : []),
    'Refunded',
  ];
  const body = lines.map((l) => {
    const r = byPart.get(l.supplierOrderId)!;
    return [
      r.orderNumber,
      spreadsheetDateTime(r.placedAt),
      spreadsheetDateTime(r.paidAt),
      r.status,
      r.supplierName,
      r.invoiceNumber,
      r.standNumber,
      r.hallName,
      r.standTypeName,
      r.companyName,
      r.contactName,
      r.email,
      r.poNumber,
      l.description,
      l.productCode,
      l.quantity,
      poundsCell(l.unitPricePence),
      poundsCell(l.netPence),
      poundsCell(l.vatPence),
      poundsCell(l.totalPence),
      ...(opts.withCommission ? [poundsCell(l.commissionPence)] : []),
      poundsCell(l.refundedPence),
    ];
  });
  return toCsv(header, body);
}

export function csvResponse(csv: string, filename: string) {
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`, 'Cache-Control': 'private, no-store' } });
}
