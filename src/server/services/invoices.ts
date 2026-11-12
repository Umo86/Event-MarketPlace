import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, type DbLike } from '../db/client';
import { files, orderLines, orders, refunds, shows, supplierOrders, suppliers } from '../db/schema';
import { can } from '../authz';
import { renderInvoice, type InvoiceDocument } from '../pdf/invoice';
import { queueEmail } from '../email/send';
import { renderSimpleEmail } from '../email/simple';
import { appUrl } from '../auth/login';
import { brandingFor } from './shows';
import { getFile, readFileBytes, storeGenerated } from './files';
import { money } from '@/lib/format';
import type { Actor } from '../auth/actor';

/**
 * VAT invoices and credit notes, one per supplier order, in the seller's name: the supplier, or
 * Media10 for its own services. Numbers come from the seller's own gap-free sequence (given when the
 * supplier order is paid, or the refund succeeds). The show's name and logo are at the top.
 */

type SO = typeof supplierOrders.$inferSelect;

function sellerOf(s: typeof suppliers.$inferSelect): InvoiceDocument['seller'] {
  return {
    legalName: s.name,
    address: [s.addressLine1, s.addressLine2, s.city, s.postcode, s.country].filter(Boolean).join('\n'),
    vatNumber: s.vatRegistered ? (s.vatNumber ?? '') : '',
    companyNumber: '',
    email: s.email,
    phone: s.phone ?? '',
  };
}

async function logoFor(show: typeof shows.$inferSelect, db: DbLike) {
  const branding = await brandingFor(show, db);
  if (!branding.logoFileId) return { logo: null, colour: branding.primaryColor };
  const file = await getFile(branding.logoFileId);
  if (!file || (file.mimeType !== 'image/png' && file.mimeType !== 'image/jpeg')) return { logo: null, colour: branding.primaryColor };
  const bytes = await readFileBytes(file);
  return { logo: bytes ? { bytes, kind: file.mimeType === 'image/png' ? ('png' as const) : ('jpeg' as const) } : null, colour: branding.primaryColor };
}

async function contextFor(db: DbLike, so: SO) {
  const [order] = await db.select().from(orders).where(eq(orders.id, so.orderId)).limit(1);
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, so.supplierId)).limit(1);
  const [show] = await db.select().from(shows).where(eq(shows.id, so.showId)).limit(1);
  const lines = await db.select().from(orderLines).where(eq(orderLines.supplierOrderId, so.id)).orderBy(orderLines.sort);
  return { order, supplier, show, lines };
}

/** The invoice PDF for a paid supplier order. */
export async function renderSupplierInvoice(db: DbLike, so: SO) {
  const { order, supplier, show, lines } = await contextFor(db, so);
  const { logo, colour } = await logoFor(show, db);
  const at = so.paidAt ?? new Date();
  return renderInvoice({
    kind: 'invoice',
    number: so.invoiceNumber!,
    issuedAt: at,
    taxPointAt: at,
    dueAt: null,
    paid: true,
    creditFor: null,
    reason: null,
    seller: sellerOf(supplier),
    buyer: { name: order.companyName, address: [], vatNumber: null, contact: order.contactName || null },
    show: { name: show.name, venue: show.venue, standNumber: order.standNumber, hall: order.hallName },
    orderNumber: order.number,
    poNumber: order.poNumber,
    lines: lines.map((l) => ({ description: `${l.description}${l.unit !== 'each' ? ` (per ${l.unit})` : ''}${l.priceBand === 'early' ? ', early-bird price' : l.priceBand === 'late' ? ', late price' : ''}`, quantity: l.quantity, unitPence: l.unitPricePence, vatRateBps: l.vatRateBps, netPence: l.netPence, vatPence: l.vatPence })),
    cardFeePence: 0,
    totalPence: so.totalPence,
    paymentInstructions: null,
    footer: `Paid by card on ${show.name}'s marketplace. ${supplier.kind === 'organiser' ? '' : `Sold by ${supplier.name}; Media10 runs the marketplace.`}`.trim(),
    brandColor: colour,
    logo,
    vatInvoice: supplier.vatRegistered,
  });
}

/** The credit note PDF for a successful refund. */
export async function renderCreditNote(db: DbLike, refund: typeof refunds.$inferSelect, so: SO) {
  const { order, supplier, show, lines } = await contextFor(db, so);
  const { logo, colour } = await logoFor(show, db);
  // Credit notes show the refunded amount split into net and VAT for each line it touched.
  const docLines = lines
    .filter((l) => (refund.lineAmounts[l.id] ?? 0) > 0)
    .map((l) => {
      const gross = refund.lineAmounts[l.id];
      const vat = l.totalPence ? Math.round((gross * l.vatPence) / l.totalPence) : 0;
      return { description: `${l.description} (refund)`, quantity: 1, unitPence: gross - vat, vatRateBps: l.vatRateBps, netPence: gross - vat, vatPence: vat };
    });
  return renderInvoice({
    kind: 'credit_note',
    number: refund.creditNoteNumber!,
    issuedAt: refund.updatedAt,
    taxPointAt: refund.updatedAt,
    dueAt: null,
    paid: false,
    creditFor: so.invoiceNumber,
    reason: refund.reason,
    seller: sellerOf(supplier),
    buyer: { name: order.companyName, address: [], vatNumber: null, contact: order.contactName || null },
    show: { name: show.name, venue: show.venue, standNumber: order.standNumber, hall: order.hallName },
    orderNumber: order.number,
    poNumber: order.poNumber,
    lines: docLines,
    cardFeePence: 0,
    totalPence: refund.amountPence,
    paymentInstructions: null,
    footer: 'Refunded to the card used to pay.',
    brandColor: colour,
    logo,
  });
}

/** Makes and stores the invoice PDF for a paid supplier order, once. */
export async function ensureInvoiceFile(so: SO) {
  if (so.invoiceFileId || !so.invoiceNumber) return so.invoiceFileId;
  const db = await getDb();
  const bytes = await renderSupplierInvoice(db, so);
  const file = await storeGenerated({ bytes, name: `${so.invoiceNumber}.pdf`, mimeType: 'application/pdf', purpose: 'invoice', showId: so.showId, supplierId: so.supplierId });
  const [row] = await db
    .update(supplierOrders)
    .set({ invoiceFileId: file.id })
    .where(and(eq(supplierOrders.id, so.id), eq(supplierOrders.invoiceNumber, so.invoiceNumber)))
    .returning({ invoiceFileId: supplierOrders.invoiceFileId });
  return row?.invoiceFileId ?? file.id;
}

/**
 * After supplier orders are paid (the order_paid job): their invoice PDFs, then one confirmation
 * email to the exhibitor listing each supplier's part, with the invoices attached.
 */
export async function afterSupplierOrdersPaid(orderId: string, supplierOrderIds: string[]) {
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || !supplierOrderIds.length) return;
  const parts = await db
    .select({ so: supplierOrders, supplierName: suppliers.name })
    .from(supplierOrders)
    .innerJoin(suppliers, eq(suppliers.id, supplierOrders.supplierId))
    .where(and(eq(supplierOrders.orderId, orderId), inArray(supplierOrders.id, supplierOrderIds)));
  const fileIds: string[] = [];
  for (const p of parts) {
    const id = await ensureInvoiceFile(p.so);
    if (id) fileIds.push(id);
  }
  const [show] = await db.select().from(shows).where(eq(shows.id, order.showId)).limit(1);
  const branding = await brandingFor(show, db);
  const all = await db.select({ status: supplierOrders.status }).from(supplierOrders).where(eq(supplierOrders.orderId, orderId));
  const stillToPay = all.some((x) => x.status === 'payment_needed' || x.status === 'pending');
  const body = renderSimpleEmail({
    heading: `Thank you: ${order.number} is ${stillToPay ? 'partly ' : ''}paid`,
    paragraphs: [
      `Your order for stand ${order.standNumber} at ${show.name}.`,
      ...parts.map((p) => `${p.supplierName}: ${money(p.so.totalPence)} paid (invoice ${p.so.invoiceNumber}).`),
      'Each supplier’s VAT invoice is attached. Each supplier is paid directly, so you’ll see a separate payment on your card statement for each.',
      ...(stillToPay ? ['Part of this order still needs paying. Open your order to pay for it.'] : []),
    ],
    button: { label: 'View your order', url: appUrl(`/${show.slug}/orders/${order.id}`) },
    brandColor: branding.primaryColor,
  });
  await queueEmail({ to: order.email, showId: show.id, templateKey: 'order_paid', category: 'transactional', subject: `${order.number}: payment received`, senderName: branding.emailSenderName ?? branding.marketplaceName, attachmentFileIds: fileIds, ...body });
}

/**
 * Who may open an invoice or credit note: the exhibitor whose order it is, the supplier's people,
 * and show staff with the orders right. Anyone else gets nothing.
 */
export async function invoiceFileFor(actor: Actor | null, fileId: string) {
  if (!actor || !/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const db = await getDb();
  const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file || file.purpose !== 'invoice') return null;
  const [asInvoice] = await db.select().from(supplierOrders).where(eq(supplierOrders.invoiceFileId, fileId)).limit(1);
  let so = asInvoice;
  if (!so) {
    const [r] = await db.select({ soId: refunds.supplierOrderId }).from(refunds).where(eq(refunds.creditNoteFileId, fileId)).limit(1);
    if (r) [so] = await db.select().from(supplierOrders).where(eq(supplierOrders.id, r.soId)).limit(1);
  }
  if (!so) return null;
  if (actor.kind === 'exhibitor') {
    const [order] = await db.select({ email: orders.email, showId: orders.showId }).from(orders).where(eq(orders.id, so.orderId)).limit(1);
    return order && order.email === actor.email && order.showId === actor.showId ? file : null;
  }
  if ((await can(actor, 'supplier.view', { supplierId: so.supplierId })) || (await can(actor, 'orders.view', { showId: so.showId }))) return file;
  return null;
}
