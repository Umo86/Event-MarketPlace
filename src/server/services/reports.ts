import 'server-only';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { getDb } from '../db/client';
import { orderLines, orders, refunds, supplierOrders, suppliers } from '../db/schema';
import { authorize } from '../authz';
import { notFound } from '../errors';
import type { Actor } from '../auth/actor';

/**
 * Orders and money for show teams and suppliers. Every figure comes straight from the supplier
 * orders and refunds, so the reports, the invoices and the credit notes always agree.
 */

const UUID = /^[0-9a-f-]{36}$/i;

const columns = {
  id: supplierOrders.id,
  orderId: orders.id,
  orderNumber: orders.number,
  placedAt: orders.createdAt,
  standNumber: orders.standNumber,
  hallName: orders.hallName,
  standTypeName: orders.standTypeName,
  companyName: orders.companyName,
  contactName: orders.contactName,
  email: orders.email,
  poNumber: orders.poNumber,
  supplierId: supplierOrders.supplierId,
  supplierName: suppliers.name,
  organiser: suppliers.kind,
  status: supplierOrders.status,
  netPence: supplierOrders.netPence,
  vatPence: supplierOrders.vatPence,
  totalPence: supplierOrders.totalPence,
  feePence: supplierOrders.feePence,
  refundedPence: supplierOrders.refundedPence,
  feeRefundedPence: supplierOrders.feeRefundedPence,
  disputedPence: supplierOrders.disputedPence,
  invoiceNumber: supplierOrders.invoiceNumber,
  invoiceFileId: supplierOrders.invoiceFileId,
  paidAt: supplierOrders.paidAt,
  paymentError: supplierOrders.paymentError,
  showId: supplierOrders.showId,
};

export type OrderRow = Awaited<ReturnType<typeof showOrderRows>>[number];

/** Every supplier order at a show (not ones cancelled before payment). Show staff with the orders right. */
export async function showOrderRows(actor: Actor, showId: string, filter: { supplierId?: string | null } = {}) {
  await authorize(actor, 'orders.view', { showId });
  const db = await getDb();
  return db
    .select(columns)
    .from(supplierOrders)
    .innerJoin(orders, eq(orders.id, supplierOrders.orderId))
    .innerJoin(suppliers, eq(suppliers.id, supplierOrders.supplierId))
    .where(and(eq(supplierOrders.showId, showId), ne(supplierOrders.status, 'cancelled'), filter.supplierId && UUID.test(filter.supplierId) ? eq(supplierOrders.supplierId, filter.supplierId) : undefined))
    .orderBy(desc(orders.createdAt), asc(suppliers.name));
}

/** A supplier's own orders, across their shows. */
export async function supplierOrderRows(actor: Actor, supplierId: string, filter: { showId?: string | null } = {}) {
  await authorize(actor, 'supplier.view', { supplierId });
  const db = await getDb();
  return db
    .select(columns)
    .from(supplierOrders)
    .innerJoin(orders, eq(orders.id, supplierOrders.orderId))
    .innerJoin(suppliers, eq(suppliers.id, supplierOrders.supplierId))
    .where(and(eq(supplierOrders.supplierId, supplierId), ne(supplierOrders.status, 'cancelled'), filter.showId && UUID.test(filter.showId) ? eq(supplierOrders.showId, filter.showId) : undefined))
    .orderBy(desc(orders.createdAt));
}

const PAID = new Set(['paid', 'part_refunded', 'refunded']);

/**
 * Takings by supplier: what exhibitors paid, refunds, Media10's commission kept (fees less fees
 * returned on refunds) and what each supplier keeps before Stripe's own fees.
 */
export function summarise(rows: OrderRow[]) {
  const by = new Map<string, { supplierId: string; supplierName: string; organiser: boolean; orders: number; paidPence: number; vatPence: number; refundedPence: number; commissionPence: number; supplierKeepsPence: number }>();
  for (const r of rows) {
    if (!PAID.has(r.status)) continue;
    const s = by.get(r.supplierId) ?? { supplierId: r.supplierId, supplierName: r.supplierName, organiser: r.organiser === 'organiser', orders: 0, paidPence: 0, vatPence: 0, refundedPence: 0, commissionPence: 0, supplierKeepsPence: 0 };
    s.orders += 1;
    s.paidPence += r.totalPence;
    s.vatPence += r.vatPence;
    s.refundedPence += r.refundedPence;
    s.commissionPence += r.feePence - r.feeRefundedPence;
    by.set(r.supplierId, s);
  }
  const list = [...by.values()].map((s) => ({ ...s, supplierKeepsPence: s.organiser ? 0 : s.paidPence - s.refundedPence - s.commissionPence }));
  const total = list.reduce(
    (a, s) => ({ orders: a.orders + s.orders, paidPence: a.paidPence + s.paidPence, vatPence: a.vatPence + s.vatPence, refundedPence: a.refundedPence + s.refundedPence, commissionPence: a.commissionPence + s.commissionPence, supplierKeepsPence: a.supplierKeepsPence + s.supplierKeepsPence }),
    { orders: 0, paidPence: 0, vatPence: 0, refundedPence: 0, commissionPence: 0, supplierKeepsPence: 0 },
  );
  return { suppliers: list.sort((a, b) => Number(a.organiser) - Number(b.organiser) || a.supplierName.localeCompare(b.supplierName)), total };
}

/** One supplier order with its lines and refunds, for the order pages. `via` is who's asking. */
export async function supplierOrderDetail(actor: Actor, supplierOrderId: string, via: { kind: 'show'; showId: string } | { kind: 'supplier'; supplierId: string }) {
  if (!UUID.test(supplierOrderId)) throw notFound();
  if (via.kind === 'show') await authorize(actor, 'orders.view', { showId: via.showId });
  else await authorize(actor, 'supplier.view', { supplierId: via.supplierId });
  const db = await getDb();
  const [row] = await db
    .select(columns)
    .from(supplierOrders)
    .innerJoin(orders, eq(orders.id, supplierOrders.orderId))
    .innerJoin(suppliers, eq(suppliers.id, supplierOrders.supplierId))
    .where(and(eq(supplierOrders.id, supplierOrderId), via.kind === 'show' ? eq(supplierOrders.showId, via.showId) : eq(supplierOrders.supplierId, via.supplierId)))
    .limit(1);
  if (!row) throw notFound();
  const lines = await db.select().from(orderLines).where(eq(orderLines.supplierOrderId, row.id)).orderBy(asc(orderLines.sort));
  const refundRows = await db.select().from(refunds).where(eq(refunds.supplierOrderId, row.id)).orderBy(asc(refunds.createdAt));
  return { row, lines, refunds: refundRows };
}

/** Lines of several supplier orders, for exports. */
export async function linesFor(supplierOrderIds: string[]) {
  if (!supplierOrderIds.length) return [];
  const db = await getDb();
  return db.select().from(orderLines).where(inArray(orderLines.supplierOrderId, supplierOrderIds)).orderBy(asc(orderLines.sort));
}
