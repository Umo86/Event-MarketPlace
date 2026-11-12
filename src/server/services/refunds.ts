import 'server-only';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type DbLike } from '../db/client';
import { disputes, orderLines, orders, refunds, shows, supplierOrders, supplierUsers, suppliers, users } from '../db/schema';
import { authorize } from '../authz';
import { conflict, invalid, notFound } from '../errors';
import { writeAudit } from '../audit';
import { enqueue } from '../jobs/queue';
import { payments } from '../payments/provider';
import { queueEmail } from '../email/send';
import { renderSimpleEmail } from '../email/simple';
import { appUrl } from '../auth/login';
import { nextNumber, refreshOrderStatus } from './orders';
import { renderCreditNote } from './invoices';
import { brandingFor } from './shows';
import { storeGenerated } from './files';
import { allocate, roundPence } from '@/lib/pricing';
import { money } from '@/lib/format';
import { systemActor, type UserActor } from '../auth/actor';

/**
 * Refunds (docs/payments.md). Made on the supplier's own Stripe account with
 * `refund_application_fee: true`, so Media10's commission comes back in proportion (DECISIONS.md,
 * decision 2). The supplier order is locked while a refund is made and each has its own
 * idempotency key, so two refunds started at once can never give back the same money. Refunds made
 * in the supplier's own Stripe dashboard are picked up from the webhook. Each successful refund
 * gets a credit note in the seller's sequence, and the exhibitor is emailed. A show admin's refund
 * needs a reason, is audited and the supplier is emailed (decision 4).
 */

const UUID = /^[0-9a-f-]{36}$/i;
const pad = (n: number) => String(n).padStart(6, '0');

export const refundSchema = z.object({
  supplierOrderId: z.string().uuid(),
  /** Pence to refund on each line; leave empty to give an amount. */
  lineAmounts: z.record(z.string().uuid(), z.number().int().min(0)).default({}),
  amountPence: z.number().int().min(0).optional(),
  reason: z.string().trim().min(3, 'Say why. The exhibitor sees this on their credit note.').max(300),
});

export type RefundInput = z.input<typeof refundSchema>;

type SO = typeof supplierOrders.$inferSelect;

/** What's left to refund on each line: what was paid less refunds made or still going through. */
async function refundable(tx: DbLike, so: SO) {
  const lines = await tx.select().from(orderLines).where(eq(orderLines.supplierOrderId, so.id)).orderBy(asc(orderLines.sort));
  const pending = await tx.select().from(refunds).where(and(eq(refunds.supplierOrderId, so.id), eq(refunds.status, 'pending')));
  const pendingByLine = new Map<string, number>();
  for (const r of pending) for (const [k, v] of Object.entries(r.lineAmounts)) pendingByLine.set(k, (pendingByLine.get(k) ?? 0) + v);
  return lines.map((l) => ({ line: l, left: Math.max(0, l.totalPence - l.refundedPence - (pendingByLine.get(l.id) ?? 0)) }));
}

function byLine(left: { line: { id: string } }[], parts: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  left.forEach((l, i) => {
    if (parts[i] > 0) out[l.line.id] = parts[i];
  });
  return out;
}

/** Splits a refund across lines: as given, or in proportion to what's left on each. */
function splitRefund(left: { line: { id: string }; left: number }[], input: { lineAmounts: Record<string, number>; amountPence?: number }): Record<string, number> {
  const given = Object.entries(input.lineAmounts).filter(([, v]) => v > 0);
  if (given.length) {
    const out: Record<string, number> = {};
    for (const [id, v] of given) {
      const l = left.find((x) => x.line.id === id);
      if (!l) throw invalid('One of those lines isn’t on this order.');
      if (v > l.left) throw invalid(`That’s more than is left to refund on a line (${money(l.left)}).`);
      out[id] = v;
    }
    return out;
  }
  const amount = input.amountPence ?? 0;
  const total = left.reduce((a, l) => a + l.left, 0);
  if (amount <= 0) throw invalid('Enter an amount to refund.', { amountPence: 'Enter an amount.' });
  if (amount > total) throw invalid(`That’s more than is left to refund (${money(total)}).`, { amountPence: `Up to ${money(total)}.` });
  const parts = allocate(
    amount,
    left.map((l) => l.left),
  );
  return byLine(left, parts);
}

/**
 * Refunds part or all of a supplier order. `via: 'supplier'` is the supplier's own panel (owner or
 * staff with the refunds right); `via: 'show'` is Media10 on the supplier's behalf (show admins, or
 * team members with the Refunds right).
 */
export async function refundSupplierOrder(actor: UserActor, raw: RefundInput, via: 'supplier' | 'show') {
  const input = refundSchema.parse(raw);
  const db = await getDb();
  const [found] = await db.select().from(supplierOrders).where(eq(supplierOrders.id, input.supplierOrderId)).limit(1);
  if (!found) throw notFound();
  if (via === 'supplier') await authorize(actor, 'supplier.refund', { supplierId: found.supplierId }, { write: true });
  else await authorize(actor, 'orders.refund', { showId: found.showId }, { write: true });
  const p = payments();
  if (!p) throw invalid('Card payments aren’t switched on, so nothing can be refunded here.');

  const result = await db.transaction(async (tx) => {
    // Locked: a second refund started now waits, then sees this one.
    const [so] = await tx.select().from(supplierOrders).where(eq(supplierOrders.id, found.id)).for('update').limit(1);
    if (so.status !== 'paid' && so.status !== 'part_refunded') throw conflict('Only a paid order can be refunded.');
    if (!so.stripePaymentIntentId && so.totalPence > 0) throw conflict('There’s no card payment to refund on this order.');
    const lineAmounts = splitRefund(await refundable(tx, so), input);
    const amount = Object.values(lineAmounts).reduce((a, b) => a + b, 0);
    const [refund] = await tx
      .insert(refunds)
      .values({ supplierOrderId: so.id, amountPence: amount, lineAmounts, reason: input.reason, requestedBy: actor.userId, byMedia10: via === 'show' })
      .returning();
    const r = await p.refund({
      account: so.chargeAccount,
      paymentIntentId: so.stripePaymentIntentId!,
      amountPence: amount,
      refundApplicationFee: true,
      idempotencyKey: `refund:${refund.id}`,
      metadata: { refundId: refund.id, supplierOrderId: so.id, orderId: so.orderId },
    });
    await tx.update(refunds).set({ stripeRefundId: r.id, status: r.status === 'failed' ? 'failed' : 'pending', error: r.status === 'failed' ? 'Stripe refused the refund.' : null }).where(eq(refunds.id, refund.id));
    const [order] = await tx.select({ number: orders.number }).from(orders).where(eq(orders.id, so.orderId)).limit(1);
    await writeAudit(tx, actor, {
      action: via === 'show' ? 'refund.by_media10' : 'refund.requested',
      summary: `${via === 'show' ? 'Refunded on the supplier’s behalf' : 'Refunded'} ${money(amount)} on ${order.number}: ${input.reason}`,
      entityType: 'refund',
      entityId: refund.id,
      showId: so.showId,
      supplierId: so.supplierId,
      details: { lineAmounts },
    });
    if (r.status === 'succeeded') await applySucceeded(tx, refund.id);
    return { refundId: refund.id, status: r.status };
  });
  if (result.status === 'succeeded') await kick();
  if (result.status === 'failed') throw invalid('Stripe didn’t make the refund. Check the supplier’s Stripe dashboard, then try again.');
  return result;
}

async function kick() {
  const { kickJobs } = await import('../jobs/run');
  await kickJobs();
}

/**
 * A refund has gone through: once only, update the lines and supplier order, give it the next
 * credit note number in the seller's sequence and queue the credit note and emails.
 */
async function applySucceeded(tx: DbLike, refundId: string) {
  const [refund] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update').limit(1);
  if (!refund || refund.creditNoteNumber) return false;
  const [so] = await tx.select().from(supplierOrders).where(eq(supplierOrders.id, refund.supplierOrderId)).for('update').limit(1);
  const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, so.supplierId)).limit(1);
  for (const [lineId, pence] of Object.entries(refund.lineAmounts)) {
    await tx
      .update(orderLines)
      .set({ refundedPence: sql`${orderLines.refundedPence} + ${pence}` })
      .where(and(eq(orderLines.id, lineId), eq(orderLines.supplierOrderId, so.id)));
  }
  const refunded = so.refundedPence + refund.amountPence;
  // Stripe returns Media10's fee in proportion; this is our record of it (the fee webhook corrects it).
  const feeBack = so.chargeAccount ? Math.min(so.feePence - so.feeRefundedPence, roundPence((so.feePence * refund.amountPence) / Math.max(1, so.totalPence))) : 0;
  await tx
    .update(supplierOrders)
    .set({ refundedPence: refunded, feeRefundedPence: so.feeRefundedPence + feeBack, status: refunded >= so.totalPence ? 'refunded' : 'part_refunded' })
    .where(eq(supplierOrders.id, so.id));
  const creditNoteNumber = `${supplier.invoicePrefix}-CRN-${pad(await nextNumber(tx, `credit:${supplier.id}`))}`;
  await tx.update(refunds).set({ status: 'succeeded', creditNoteNumber, feeRefundedPence: feeBack, error: null }).where(eq(refunds.id, refund.id));
  await refreshOrderStatus(tx, so.orderId);
  await enqueue('refund_succeeded', { refundId: refund.id }, { tx, dedupeKey: `refund:${refund.id}` });
  return true;
}

/** The refund_succeeded job: the credit note PDF, then emails to the exhibitor (and the supplier, if Media10 made it). */
export async function afterRefund(refundId: string) {
  const db = await getDb();
  const [refund] = await db.select().from(refunds).where(eq(refunds.id, refundId)).limit(1);
  if (!refund || refund.status !== 'succeeded') return;
  const [so] = await db.select().from(supplierOrders).where(eq(supplierOrders.id, refund.supplierOrderId)).limit(1);
  let fileId = refund.creditNoteFileId;
  if (!fileId) {
    const bytes = await renderCreditNote(db, refund, so);
    const file = await storeGenerated({ bytes, name: `${refund.creditNoteNumber}.pdf`, mimeType: 'application/pdf', purpose: 'invoice', showId: so.showId, supplierId: so.supplierId });
    fileId = file.id;
    await db.update(refunds).set({ creditNoteFileId: file.id }).where(eq(refunds.id, refund.id));
  }
  const [order] = await db.select().from(orders).where(eq(orders.id, so.orderId)).limit(1);
  const [show] = await db.select().from(shows).where(eq(shows.id, so.showId)).limit(1);
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, so.supplierId)).limit(1);
  const branding = await brandingFor(show, db);
  const body = renderSimpleEmail({
    heading: `${money(refund.amountPence)} refunded`,
    paragraphs: [
      `${supplier.name} has refunded ${money(refund.amountPence)} on ${order.number} (stand ${order.standNumber}) to the card you paid with.`,
      `Reason: ${refund.reason}`,
      `The credit note ${refund.creditNoteNumber} is attached. Refunds usually reach your card in 5 to 10 working days.`,
    ],
    button: { label: 'View your order', url: appUrl(`/${show.slug}/orders/${order.id}`) },
    brandColor: branding.primaryColor,
  });
  await queueEmail({ to: order.email, showId: show.id, templateKey: 'refund_made', category: 'transactional', subject: `${order.number}: ${money(refund.amountPence)} refunded`, senderName: branding.emailSenderName ?? branding.marketplaceName, attachmentFileIds: [fileId], ...body });
  if (refund.byMedia10 && supplier.kind === 'company') {
    const people = await db
      .select({ email: users.email })
      .from(supplierUsers)
      .innerJoin(users, eq(users.id, supplierUsers.userId))
      .where(and(eq(supplierUsers.supplierId, supplier.id), eq(users.status, 'active')));
    for (const person of people) {
      const note = renderSimpleEmail({
        heading: `Media10 refunded ${money(refund.amountPence)} on ${order.number}`,
        paragraphs: [
          `The ${show.name} team refunded ${money(refund.amountPence)} from your Stripe account to ${order.companyName} (stand ${order.standNumber}).`,
          `Their reason: ${refund.reason}`,
          `Credit note ${refund.creditNoteNumber} was made in your name. Media10’s commission on this amount was returned to you.`,
        ],
        button: { label: 'Open your panel', url: appUrl(`/supplier/${supplier.id}`) },
      });
      await queueEmail({ to: person.email, showId: show.id, templateKey: 'refund_by_media10', category: 'transactional', subject: `Refund on ${order.number} by the ${show.name} team`, ...note });
    }
  }
  await kick();
}

/**
 * From the Connect webhook (refund.created/updated, charge.refunded): brings our records in line
 * with Stripe. Our own refunds move from pending to succeeded or failed; refunds made in the
 * supplier's own dashboard are recorded, by Stripe's refund id, exactly once.
 */
export async function reconcileRefunds(account: string | null, paymentIntentId: string) {
  const p = payments();
  if (!p) return 0;
  const db = await getDb();
  const [so] = await db
    .select()
    .from(supplierOrders)
    .where(and(eq(supplierOrders.stripePaymentIntentId, paymentIntentId), account ? eq(supplierOrders.chargeAccount, account) : sql`${supplierOrders.chargeAccount} is null`))
    .limit(1);
  if (!so) return 0;
  const remote = await p.listRefunds(account, paymentIntentId);
  let changed = 0;
  for (const r of remote.sort((a, b) => a.created - b.created)) {
    const done = await db.transaction(async (tx) => {
      await tx.select({ id: supplierOrders.id }).from(supplierOrders).where(eq(supplierOrders.id, so.id)).for('update');
      const [ours] = await tx.select().from(refunds).where(eq(refunds.stripeRefundId, r.id)).limit(1);
      if (ours) {
        if (ours.status === 'pending' && r.status === 'succeeded') return applySucceeded(tx, ours.id);
        if (ours.status === 'pending' && r.status === 'failed') {
          await tx.update(refunds).set({ status: 'failed', error: 'Stripe couldn’t make the refund.' }).where(eq(refunds.id, ours.id));
          return true;
        }
        return false;
      }
      if (r.status !== 'succeeded') return false;
      // Made in the supplier's own Stripe dashboard.
      const [current] = await tx.select().from(supplierOrders).where(eq(supplierOrders.id, so.id)).limit(1);
      const left = await refundable(tx, current);
      const total = left.reduce((a, l) => a + l.left, 0);
      const amount = Math.min(r.amountPence, total);
      if (amount <= 0) return false;
      const parts = allocate(
        amount,
        left.map((l) => l.left),
      );
      const lineAmounts = byLine(left, parts);
      const [row] = await tx
        .insert(refunds)
        .values({ supplierOrderId: so.id, amountPence: amount, lineAmounts, reason: 'Refunded by the supplier in Stripe', source: 'stripe', stripeRefundId: r.id })
        .onConflictDoNothing()
        .returning();
      if (!row) return false;
      await writeAudit(tx, systemActor('Stripe webhook'), { action: 'refund.from_stripe', summary: `${money(amount)} refunded in the supplier’s Stripe dashboard`, entityType: 'refund', entityId: row.id, showId: so.showId, supplierId: so.supplierId });
      return applySucceeded(tx, row.id);
    });
    if (done) changed++;
  }
  if (changed) await kick();
  return changed;
}

/** Stripe's record of Media10's fee returned on refunds (application_fee.refunded). */
export async function applyFeeRefunded(chargeId: string, refundedPence: number) {
  const db = await getDb();
  await db.update(supplierOrders).set({ feeRefundedPence: refundedPence }).where(eq(supplierOrders.stripeChargeId, chargeId));
}

/** A card dispute (chargeback) opened, changed or closed on a supplier's charge. */
export async function applyDispute(account: string | null, d: { id: string; amount: number; status: string; reason?: string | null; payment_intent?: string | null; evidence_details?: { due_by?: number | null } | null }) {
  if (!d.payment_intent) return 'ignored' as const;
  const db = await getDb();
  const [so] = await db
    .select()
    .from(supplierOrders)
    .where(and(eq(supplierOrders.stripePaymentIntentId, d.payment_intent), account ? eq(supplierOrders.chargeAccount, account) : sql`${supplierOrders.chargeAccount} is null`))
    .limit(1);
  if (!so) return 'ignored' as const;
  await db.transaction(async (tx) => {
    const due = d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null;
    const [existing] = await tx.select().from(disputes).where(eq(disputes.stripeDisputeId, d.id)).limit(1);
    if (existing) await tx.update(disputes).set({ status: d.status, amountPence: d.amount, reason: d.reason ?? null, evidenceDueBy: due }).where(eq(disputes.id, existing.id));
    else await tx.insert(disputes).values({ supplierOrderId: so.id, stripeDisputeId: d.id, amountPence: d.amount, status: d.status, reason: d.reason ?? null, evidenceDueBy: due });
    const open = await tx.select({ amount: disputes.amountPence, status: disputes.status }).from(disputes).where(eq(disputes.supplierOrderId, so.id));
    await tx
      .update(supplierOrders)
      .set({ disputedPence: open.filter((x) => !['won', 'lost', 'warning_closed', 'prevented'].includes(x.status)).reduce((a, x) => a + x.amount, 0) })
      .where(eq(supplierOrders.id, so.id));
    if (!existing) await writeAudit(tx, systemActor('Stripe webhook'), { action: 'dispute.opened', summary: `A card dispute for ${money(d.amount)} was opened (${d.reason ?? 'no reason given'})`, entityType: 'supplier_order', entityId: so.id, showId: so.showId, supplierId: so.supplierId });
  });
  return 'applied' as const;
}

export async function refundsForOrder(orderId: string) {
  if (!UUID.test(orderId)) return [];
  const db = await getDb();
  const parts = await db.select({ id: supplierOrders.id }).from(supplierOrders).where(eq(supplierOrders.orderId, orderId));
  if (!parts.length) return [];
  return db
    .select()
    .from(refunds)
    .where(
      inArray(
        refunds.supplierOrderId,
        parts.map((p) => p.id),
      ),
    )
    .orderBy(asc(refunds.createdAt));
}

