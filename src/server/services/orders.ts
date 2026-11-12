import 'server-only';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { getDb, type DbLike } from '../db/client';
import { basketItems, exhibitorContacts, halls, orderLines, orders, products, showCategories, shows, standTypes, stands, supplierOrders, suppliers, type SupplierOrderStatus } from '../db/schema';
import { authorize } from '../authz';
import { conflict, invalid, notFound } from '../errors';
import { writeAudit } from '../audit';
import { enqueue } from '../jobs/queue';
import { payments, simulatorActive } from '../payments/provider';
import { getSetting } from './settings';
import { heldQuantities } from './stock';
import { canOrder, orderingState } from '@/lib/ordering';
import { priceFor, priceLine, resolveCommission, sumLines } from '@/lib/pricing';
import { money } from '@/lib/format';
import { systemActor, type Actor, type ExhibitorActor } from '../auth/actor';

/**
 * The basket, placing an order and paying for it (docs/payments.md).
 *
 * The basket holds what an exhibitor still wants for one stand. Placing an order prices it, holds
 * the stock for an hour and splits it into one supplier order per supplier. The card is saved once
 * (a SetupIntent on Media10's account), then each supplier order is charged on its own: straight
 * onto the supplier's Stripe account with Media10's commission as the application fee, or on
 * Media10's own account for Media10's own services. If one charge fails the others still go
 * through, and that part shows "Payment needed". Paid items leave the basket.
 */

const UUID = /^[0-9a-f-]{36}$/i;
export const HOLD_MINUTES = 60;
export const MAX_QUANTITY = 999;

/** The stand, if this exhibitor contact is on it. */
async function standFor(actor: ExhibitorActor, standId: string, db: DbLike) {
  if (!UUID.test(standId)) throw notFound();
  const [row] = await db
    .select({ id: stands.id, number: stands.number, company: stands.companyName, hall: halls.name, standType: standTypes.name, standTypeKey: standTypes.key, contactName: exhibitorContacts.name })
    .from(exhibitorContacts)
    .innerJoin(stands, eq(stands.id, exhibitorContacts.standId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .leftJoin(standTypes, eq(standTypes.id, stands.standTypeId))
    .where(and(eq(exhibitorContacts.showId, actor.showId), eq(exhibitorContacts.email, actor.email), eq(exhibitorContacts.standId, standId), eq(exhibitorContacts.status, 'active'), eq(stands.status, 'active')))
    .limit(1);
  if (!row) throw notFound('That stand isn’t one of yours. Choose your stand again.');
  return row;
}

type Sellable = {
  product: typeof products.$inferSelect;
  category: typeof showCategories.$inferSelect;
  supplier: typeof suppliers.$inferSelect;
};

/** Products that can be ordered for this stand now, with everything needed to price them. Locked with `lock`. */
async function sellableProducts(db: DbLike, showId: string, productIds: string[], standTypeKey: string | null, opts: { lock?: boolean } = {}) {
  if (!productIds.length) return new Map<string, Sellable>();
  const q = db
    .select({ product: products, category: showCategories, supplier: suppliers })
    .from(products)
    .innerJoin(showCategories, and(eq(showCategories.id, products.categoryId), eq(showCategories.supplierId, products.supplierId)))
    .innerJoin(suppliers, eq(suppliers.id, products.supplierId))
    .where(and(eq(products.showId, showId), inArray(products.id, productIds), eq(products.status, 'live')));
  const rows = opts.lock ? await q.for('update', { of: products }) : await q;
  const out = new Map<string, Sellable>();
  for (const r of rows) {
    const ready = !r.supplier.pausedAt && (r.supplier.kind === 'organiser' || r.supplier.stripeChargesEnabled);
    const typeOk = r.product.standTypeKeys.length === 0 || (standTypeKey !== null && r.product.standTypeKeys.includes(standTypeKey));
    if (ready && typeOk) out.set(r.product.id, r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Basket
// ---------------------------------------------------------------------------

export async function setBasketQuantity(actor: Actor, showId: string, input: { standId: string; productId: string; quantity: number }, now = new Date()) {
  await authorize(actor, 'storefront.order', { showId });
  const ex = actor as ExhibitorActor;
  const qty = Math.floor(input.quantity);
  if (!Number.isFinite(qty) || qty < 0 || qty > MAX_QUANTITY) throw invalid(`Choose a quantity from 0 to ${MAX_QUANTITY}.`, { quantity: 'Choose a quantity.' });
  if (!UUID.test(input.productId)) throw notFound();
  const db = await getDb();
  const stand = await standFor(ex, input.standId, db);
  if (qty === 0) {
    await db.delete(basketItems).where(and(eq(basketItems.standId, stand.id), eq(basketItems.email, ex.email), eq(basketItems.productId, input.productId)));
    return;
  }
  const [show] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1);
  if (!canOrder(orderingState(show, now))) throw invalid('Ordering isn’t open for this show right now.');
  const found = (await sellableProducts(db, showId, [input.productId], stand.standTypeKey)).get(input.productId);
  if (!found) throw invalid('That product can’t be ordered for this stand any more.');
  if (found.product.stockLimit !== null) {
    const held = (await heldQuantities([found.product.id], { db, now })).get(found.product.id) ?? 0;
    const left = Math.max(0, found.product.stockLimit - held);
    if (qty > left) throw invalid(left ? `Only ${left} left. Choose ${left} or fewer.` : 'That’s sold out.', { quantity: left ? `Only ${left} left.` : 'Sold out.' });
  }
  await db
    .insert(basketItems)
    .values({ showId, standId: stand.id, email: ex.email, productId: input.productId, quantity: qty })
    .onConflictDoUpdate({ target: [basketItems.standId, basketItems.email, basketItems.productId], set: { quantity: qty, updatedAt: new Date() } });
}

export type BasketLine = {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  unitPence: number;
  band: 'early' | 'standard' | 'late';
  vatRateBps: number;
  netPence: number;
  vatPence: number;
  totalPence: number;
};

export type BasketGroup = { supplierId: string; supplierName: string; organiser: boolean; lines: BasketLine[]; netPence: number; vatPence: number; totalPence: number };

/** The basket for one stand, grouped by supplier at today's prices, with anything that can no longer be ordered. */
export async function basketFor(actor: Actor, showId: string, standId: string, now = new Date()) {
  await authorize(actor, 'storefront.browse', { showId });
  const ex = actor as ExhibitorActor;
  const db = await getDb();
  const stand = await standFor(ex, standId, db);
  const [show] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1);
  const items = await db
    .select({ productId: basketItems.productId, quantity: basketItems.quantity, name: products.name })
    .from(basketItems)
    .innerJoin(products, eq(products.id, basketItems.productId))
    .where(and(eq(basketItems.standId, stand.id), eq(basketItems.email, ex.email)))
    .orderBy(asc(basketItems.createdAt));
  const sellable = await sellableProducts(
    db,
    showId,
    items.map((i) => i.productId),
    stand.standTypeKey,
  );
  const groups = new Map<string, BasketGroup>();
  const unavailable: { productId: string; name: string }[] = [];
  for (const item of items) {
    const s = sellable.get(item.productId);
    if (!s) {
      unavailable.push({ productId: item.productId, name: item.name });
      continue;
    }
    const price = priceFor(s.product, show, now);
    const priced = priceLine({ unitPence: price.unitPence, quantity: item.quantity, vatRateBps: s.product.vatRateBps, commission: { type: 'percent', value: 0 }, organiser: true });
    const g = groups.get(s.supplier.id) ?? { supplierId: s.supplier.id, supplierName: s.supplier.name, organiser: s.supplier.kind === 'organiser', lines: [], netPence: 0, vatPence: 0, totalPence: 0 };
    g.lines.push({ productId: s.product.id, name: s.product.name, unit: s.product.unit, quantity: item.quantity, unitPence: price.unitPence, band: price.band, vatRateBps: s.product.vatRateBps, netPence: priced.netPence, vatPence: priced.vatPence, totalPence: priced.totalPence });
    g.netPence += priced.netPence;
    g.vatPence += priced.vatPence;
    g.totalPence += priced.totalPence;
    groups.set(s.supplier.id, g);
  }
  const list = [...groups.values()].sort((a, b) => Number(a.organiser) - Number(b.organiser) || a.supplierName.localeCompare(b.supplierName));
  return {
    stand,
    groups: list,
    unavailable,
    netPence: list.reduce((a, g) => a + g.netPence, 0),
    vatPence: list.reduce((a, g) => a + g.vatPence, 0),
    totalPence: list.reduce((a, g) => a + g.totalPence, 0),
    count: list.reduce((a, g) => a + g.lines.reduce((b, l) => b + l.quantity, 0), 0),
    canOrder: canOrder(orderingState(show, now)),
  };
}

/** Items in the person's baskets for this show (for the header). */
export async function basketCount(actor: ExhibitorActor) {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${basketItems.quantity}), 0)::int` })
    .from(basketItems)
    .where(and(eq(basketItems.showId, actor.showId), eq(basketItems.email, actor.email)));
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Placing an order
// ---------------------------------------------------------------------------

/** The next number in a gap-free sequence, in the same transaction as the thing it numbers. */
export async function nextNumber(tx: DbLike, key: string): Promise<number> {
  const result = (await tx.execute(sql`insert into counters (key, value) values (${key}, 1) on conflict (key) do update set value = counters.value + 1 returning value`)) as unknown as { rows: { value: number | string }[] };
  return Number(result.rows[0].value);
}

const pad = (n: number) => String(n).padStart(6, '0');

/**
 * Turns the basket into an order: checks every product is still for sale and in stock (with the
 * products locked, so two people can't buy the last one), prices each line at today's price with
 * its commission, and holds the stock for an hour. Any earlier unpaid order for the same stand
 * is cancelled first: its items are still in the basket.
 */
export async function placeOrder(actor: Actor, showId: string, input: { standId: string; poNumber?: string | null }, now = new Date()) {
  await authorize(actor, 'storefront.order', { showId });
  const ex = actor as ExhibitorActor;
  const db = await getDb();
  const platformDefault = await getSetting('commissionDefault');
  return db.transaction(async (tx) => {
    const stand = await standFor(ex, input.standId, tx);
    const [show] = await tx.select().from(shows).where(eq(shows.id, showId)).limit(1);
    if (!canOrder(orderingState(show, now))) throw invalid('Ordering isn’t open for this show right now.');
    const items = await tx
      .select()
      .from(basketItems)
      .where(and(eq(basketItems.standId, stand.id), eq(basketItems.email, ex.email)));
    if (!items.length) throw invalid('Your basket is empty.');

    await cancelUnpaid(tx, ex, stand.id, now);

    const sellable = await sellableProducts(
      tx,
      showId,
      items.map((i) => i.productId),
      stand.standTypeKey,
      { lock: true },
    );
    const missing = items.filter((i) => !sellable.has(i.productId));
    if (missing.length) throw conflict('Something in your basket can’t be ordered any more. Take it out of your basket and try again.');
    const limited = items.filter((i) => sellable.get(i.productId)!.product.stockLimit !== null);
    const held = await heldQuantities(
      limited.map((i) => i.productId),
      { db: tx, now },
    );
    for (const i of limited) {
      const p = sellable.get(i.productId)!.product;
      const left = p.stockLimit! - (held.get(p.id) ?? 0);
      if (i.quantity > left) throw conflict(left > 0 ? `Only ${left} of ${p.name} left. Change the quantity in your basket.` : `${p.name} has just sold out. Take it out of your basket.`);
    }

    // Price every line, grouped by supplier.
    type Line = { item: (typeof items)[number]; s: Sellable; unitPence: number; band: 'early' | 'standard' | 'late'; priced: ReturnType<typeof priceLine> };
    const bySupplier = new Map<string, Line[]>();
    for (const item of items) {
      const s = sellable.get(item.productId)!;
      const price = priceFor(s.product, show, now);
      const organiser = s.supplier.kind === 'organiser';
      const commission = resolveCommission(
        { type: s.product.commissionType, value: s.product.commissionValue },
        { type: s.category.commissionType, value: s.category.commissionValue },
        { type: s.supplier.commissionType, value: s.supplier.commissionValue },
        { type: show.commissionType, value: show.commissionValue },
        platformDefault,
      );
      const priced = priceLine({ unitPence: price.unitPence, quantity: item.quantity, vatRateBps: s.product.vatRateBps, commission, organiser });
      bySupplier.set(s.supplier.id, [...(bySupplier.get(s.supplier.id) ?? []), { item, s, unitPence: price.unitPence, band: price.band, priced }]);
    }
    const all = [...bySupplier.values()].flat();
    const totals = sumLines(all.map((l) => l.priced));
    const number = `ORD-${pad(await nextNumber(tx, 'order'))}`;
    const [contact] = await tx
      .select({ name: exhibitorContacts.name })
      .from(exhibitorContacts)
      .where(and(eq(exhibitorContacts.showId, showId), eq(exhibitorContacts.standId, stand.id), eq(exhibitorContacts.email, ex.email)))
      .limit(1);
    const [order] = await tx
      .insert(orders)
      .values({
        number,
        showId,
        standId: stand.id,
        email: ex.email,
        contactName: contact?.name ?? '',
        companyName: stand.company,
        standNumber: stand.number,
        hallName: stand.hall,
        standTypeName: stand.standType,
        poNumber: input.poNumber?.trim().slice(0, 60) || null,
        netPence: totals.netPence,
        vatPence: totals.vatPence,
        totalPence: totals.totalPence,
        holdUntil: new Date(now.getTime() + HOLD_MINUTES * 60_000),
      })
      .returning();
    let sort = 0;
    for (const [supplierId, lines] of bySupplier) {
      const supplier = lines[0].s.supplier;
      const t = sumLines(lines.map((l) => l.priced));
      const [so] = await tx
        .insert(supplierOrders)
        .values({
          orderId: order.id,
          showId,
          supplierId,
          chargeAccount: supplier.kind === 'organiser' ? null : supplier.stripeAccountId,
          netPence: t.netPence,
          vatPence: t.vatPence,
          totalPence: t.totalPence,
          feePence: t.commissionPence,
        })
        .returning();
      await tx.insert(orderLines).values(
        lines.map((l) => ({
          orderId: order.id,
          supplierOrderId: so.id,
          productId: l.s.product.id,
          categoryId: l.s.category.id,
          description: l.s.product.name,
          productCode: l.s.product.code,
          unit: l.s.product.unit,
          quantity: l.item.quantity,
          unitPricePence: l.unitPence,
          priceBand: l.band,
          vatRateBps: l.s.product.vatRateBps,
          netPence: l.priced.netPence,
          vatPence: l.priced.vatPence,
          totalPence: l.priced.totalPence,
          commissionPence: l.priced.commissionPence,
          sort: sort++,
        })),
      );
    }
    await writeAudit(tx, ex, {
      action: 'order.placed',
      summary: `Placed ${number} for stand ${stand.number}: ${money(totals.totalPence)} across ${bySupplier.size} ${bySupplier.size === 1 ? 'supplier' : 'suppliers'}`,
      entityType: 'order',
      entityId: order.id,
      showId,
    });
    return order;
  });
}

/** Cancels this person's unpaid supplier orders for the stand (their items are still in the basket). */
async function cancelUnpaid(tx: DbLike, ex: ExhibitorActor, standId: string, now: Date) {
  const open = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.standId, standId), eq(orders.email, ex.email), inArray(orders.status, ['pending_payment', 'part_paid', 'payment_needed'])))
    .for('update');
  for (const o of open) {
    await tx
      .update(supplierOrders)
      .set({ status: 'cancelled' })
      .where(and(eq(supplierOrders.orderId, o.id), inArray(supplierOrders.status, ['pending', 'payment_needed'])));
    await refreshOrderStatus(tx, o.id, now);
  }
}

/** Works out the order's status from its supplier orders. */
export async function refreshOrderStatus(tx: DbLike, orderId: string, now = new Date()) {
  const parts = await tx.select({ status: supplierOrders.status }).from(supplierOrders).where(eq(supplierOrders.orderId, orderId));
  const paidLike = (s: SupplierOrderStatus) => s === 'paid' || s === 'part_refunded' || s === 'refunded';
  const live = parts.filter((p) => p.status !== 'cancelled');
  const paid = live.filter((p) => paidLike(p.status)).length;
  const needed = live.filter((p) => p.status === 'payment_needed').length;
  let status: (typeof orders.$inferSelect)['status'];
  if (!live.length) status = 'cancelled';
  else if (paid === live.length) status = 'paid';
  else if (paid > 0) status = 'part_paid';
  else if (needed > 0) status = 'payment_needed';
  else status = 'pending_payment';
  const [row] = await tx
    .update(orders)
    .set({ status, ...(status === 'paid' ? { paidAt: sql`coalesce(${orders.paidAt}, ${now.toISOString()}::timestamptz)` } : {}), ...(status === 'cancelled' ? { cancelledAt: now } : {}) })
    .where(eq(orders.id, orderId))
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// Paying
// ---------------------------------------------------------------------------

async function ownOrder(ex: ExhibitorActor, orderId: string, db: DbLike) {
  if (!UUID.test(orderId)) throw notFound();
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.showId, ex.showId), eq(orders.email, ex.email)))
    .limit(1);
  if (!order) throw notFound();
  return order;
}

/** The supplier orders still to pay for. */
async function unpaidParts(db: DbLike, orderId: string) {
  return db
    .select()
    .from(supplierOrders)
    .where(and(eq(supplierOrders.orderId, orderId), inArray(supplierOrders.status, ['pending', 'payment_needed'])));
}

/**
 * Starts (or restarts) paying: makes sure the stock is still held, then a SetupIntent to save the
 * card. With the simulator there's no SetupIntent: the test payment page stands in.
 */
export async function startPayment(actor: Actor, showId: string, orderId: string, now = new Date()) {
  await authorize(actor, 'storefront.order', { showId });
  const ex = actor as ExhibitorActor;
  const p = payments();
  if (!p) throw invalid('Card payments aren’t switched on yet. The show team will let you know when you can order.');
  const db = await getDb();
  const order = await ownOrder(ex, orderId, db);
  if (!(await unpaidParts(db, orderId)).length) throw invalid('This order is already paid.');
  await keepHold(order, now);
  if (p.kind === 'simulator') return { mode: 'simulator' as const, clientSecret: null, publishableKey: null };
  const customerId = order.stripeCustomerId ?? (await p.createCustomer({ email: order.email, name: order.contactName || order.companyName, orderId, idempotencyKey: `customer:${orderId}` })).id;
  const si = await p.createSetupIntent({ customerId, orderId, idempotencyKey: `setup:${orderId}:${now.getTime()}` });
  await db.update(orders).set({ stripeCustomerId: customerId, stripeSetupIntentId: si.id }).where(eq(orders.id, orderId));
  return { mode: 'stripe' as const, clientSecret: si.clientSecret, publishableKey: p.publishableKey() };
}

/** If the hour has passed, holds the stock again for another hour, if there's still enough. */
async function keepHold(order: typeof orders.$inferSelect, now: Date) {
  if (order.holdUntil > now) return;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const lines = await tx
      .select({ productId: orderLines.productId, quantity: orderLines.quantity, name: orderLines.description, stockLimit: products.stockLimit })
      .from(orderLines)
      .innerJoin(supplierOrders, eq(supplierOrders.id, orderLines.supplierOrderId))
      .innerJoin(products, eq(products.id, orderLines.productId))
      .where(and(eq(orderLines.orderId, order.id), inArray(supplierOrders.status, ['pending', 'payment_needed'])))
      .for('update', { of: products });
    const limited = lines.filter((l) => l.stockLimit !== null);
    const held = await heldQuantities(
      limited.map((l) => l.productId!),
      { db: tx, now, excludeOrderId: order.id },
    );
    for (const l of limited) {
      if (l.quantity > l.stockLimit! - (held.get(l.productId!) ?? 0)) throw conflict(`${l.name} has sold out since you ordered. Go back to your basket to change your order.`);
    }
    await tx
      .update(orders)
      .set({ holdUntil: new Date(now.getTime() + HOLD_MINUTES * 60_000) })
      .where(eq(orders.id, order.id));
  });
}

/** After the Payment Element: checks the SetupIntent is this order's and has saved a card, then charges. */
export async function completePayment(actor: Actor, showId: string, orderId: string, setupIntentId: string) {
  await authorize(actor, 'storefront.order', { showId });
  const ex = actor as ExhibitorActor;
  const p = payments();
  if (!p || p.kind !== 'stripe') throw notFound();
  const db = await getDb();
  const order = await ownOrder(ex, orderId, db);
  if (!order.stripeSetupIntentId || order.stripeSetupIntentId !== setupIntentId) throw notFound();
  const si = await p.setupIntentStatus(setupIntentId);
  if (si.status === 'processing') return { status: 'processing' as const };
  if (si.status !== 'succeeded' || !si.paymentMethodId || si.customerId !== order.stripeCustomerId) throw invalid('Your card wasn’t saved. Try again, or use another card.');
  await db.update(orders).set({ stripePaymentMethodId: si.paymentMethodId }).where(eq(orders.id, orderId));
  return { status: 'charged' as const, result: await chargeOrder(orderId, ex) };
}

/** The local simulator's stand-in for the card form. Never on a live site. */
export async function simulatePayment(actor: Actor, showId: string, orderId: string, outcome: { declineSupplierId?: string | null } = {}) {
  await authorize(actor, 'storefront.order', { showId });
  if (!simulatorActive()) throw notFound();
  const ex = actor as ExhibitorActor;
  const db = await getDb();
  await ownOrder(ex, orderId, db);
  await keepHold((await ownOrder(ex, orderId, db))!, new Date());
  const pm = outcome.declineSupplierId ? `pm_sim_decline:${outcome.declineSupplierId}` : `pm_sim_ok_${Date.now()}`;
  await db.update(orders).set({ stripeCustomerId: `cus_sim${orderId.replace(/-/g, '').slice(0, 14)}`, stripePaymentMethodId: pm }).where(eq(orders.id, orderId));
  return chargeOrder(orderId, ex);
}

/**
 * Charges every unpaid supplier order on the order's saved card, each on its own. Each one is
 * locked while it's charged and the idempotency key ties the charge to this card, so a page that's
 * refreshed, a second tab and the webhook can never charge twice.
 */
export async function chargeOrder(orderId: string, actor: Actor = systemActor('payment')) {
  const p = payments();
  if (!p) throw invalid('Card payments aren’t switched on yet.');
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw notFound();
  if (!order.stripePaymentMethodId || !order.stripeCustomerId) throw invalid('There’s no card saved for this order yet.');
  const parts = await unpaidParts(db, orderId);
  const supplierRows = parts.length ? await db.select().from(suppliers).where(inArray(suppliers.id, parts.map((x) => x.supplierId))) : [];
  const names = new Map(supplierRows.map((s) => [s.id, s]));
  const outcomes: { supplierOrderId: string; supplierName: string; status: 'paid' | 'payment_needed' | 'processing'; message: string | null }[] = [];
  const paidNow: string[] = [];

  for (const part of parts) {
    const supplier = names.get(part.supplierId)!;
    const outcome = await db.transaction(async (tx) => {
      const [so] = await tx.select().from(supplierOrders).where(eq(supplierOrders.id, part.id)).for('update').limit(1);
      if (!so || (so.status !== 'pending' && so.status !== 'payment_needed')) return null;
      // A zero total needs no charge.
      if (so.totalPence === 0) {
        await markPaid(tx, so, supplier, { paymentIntentId: null, chargeId: null });
        return { status: 'paid' as const, message: null };
      }
      if (so.chargeAccount === null && supplier.kind !== 'organiser') {
        await tx.update(supplierOrders).set({ status: 'payment_needed', paymentError: 'This supplier can’t take payments yet. The show team has been told.' }).where(eq(supplierOrders.id, so.id));
        return { status: 'payment_needed' as const, message: 'This supplier can’t take payments yet.' };
      }
      const result = await p.charge({
        account: so.chargeAccount,
        customerId: order.stripeCustomerId!,
        paymentMethodId: order.stripePaymentMethodId!,
        amountPence: so.totalPence,
        feePence: so.feePence,
        description: `${order.number} · stand ${order.standNumber} · ${supplier.name}`,
        statementSuffix: order.number.replace('ORD-', 'ORD'),
        metadata: { orderId: order.id, orderNumber: order.number, supplierOrderId: so.id, supplierId: so.supplierId, showId: order.showId },
        idempotencyKey: `charge:${so.id}:${order.stripePaymentMethodId}`,
      });
      if (result.status === 'succeeded') {
        await markPaid(tx, so, supplier, { paymentIntentId: result.paymentIntentId, chargeId: result.chargeId });
        return { status: 'paid' as const, message: null };
      }
      if (result.status === 'processing') {
        await tx.update(supplierOrders).set({ stripePaymentIntentId: result.paymentIntentId, attempts: so.attempts + 1, paymentError: null }).where(eq(supplierOrders.id, so.id));
        return { status: 'processing' as const, message: 'Your bank is still processing this payment.' };
      }
      await tx
        .update(supplierOrders)
        .set({ status: 'payment_needed', paymentError: result.message, attempts: so.attempts + 1, stripePaymentIntentId: so.stripePaymentIntentId ?? null })
        .where(eq(supplierOrders.id, so.id));
      await writeAudit(tx, actor, { action: 'payment.failed', summary: `Payment for ${supplier.name} on ${order.number} didn’t go through: ${result.message}`, entityType: 'supplier_order', entityId: so.id, showId: order.showId, supplierId: so.supplierId });
      return { status: 'payment_needed' as const, message: result.message };
    });
    if (!outcome) continue;
    if (outcome.status === 'paid') paidNow.push(part.id);
    outcomes.push({ supplierOrderId: part.id, supplierName: supplier.name, ...outcome });
  }

  await db.transaction(async (tx) => {
    await refreshOrderStatus(tx, orderId);
    if (paidNow.length) await enqueue('order_paid', { orderId, supplierOrderIds: paidNow }, { tx, dedupeKey: `order-paid:${paidNow.sort().join(',')}` });
  });
  if (paidNow.length) {
    const { kickJobs } = await import('../jobs/run');
    await kickJobs();
  }
  return outcomes;
}

/**
 * A supplier order is paid: give it the next invoice number in the seller's own sequence, take its
 * items out of the basket, and record it.
 */
export async function markPaid(tx: DbLike, so: typeof supplierOrders.$inferSelect, supplier: typeof suppliers.$inferSelect, ids: { paymentIntentId: string | null; chargeId: string | null }, now = new Date()) {
  const invoiceNumber = `${supplier.invoicePrefix}-INV-${pad(await nextNumber(tx, `invoice:${supplier.id}`))}`;
  await tx
    .update(supplierOrders)
    .set({ status: 'paid', paidAt: now, paymentError: null, invoiceNumber, stripePaymentIntentId: ids.paymentIntentId ?? so.stripePaymentIntentId, stripeChargeId: ids.chargeId ?? so.stripeChargeId, attempts: so.attempts + 1 })
    .where(eq(supplierOrders.id, so.id));
  const [order] = await tx.select().from(orders).where(eq(orders.id, so.orderId)).limit(1);
  const lines = await tx.select({ productId: orderLines.productId, quantity: orderLines.quantity }).from(orderLines).where(eq(orderLines.supplierOrderId, so.id));
  for (const l of lines) {
    if (!l.productId) continue;
    await tx.execute(sql`update basket_items set quantity = quantity - ${l.quantity}, updated_at = now() where stand_id = ${order.standId} and email = ${order.email} and product_id = ${l.productId}`);
  }
  await tx.delete(basketItems).where(and(eq(basketItems.standId, order.standId), eq(basketItems.email, order.email), sql`${basketItems.quantity} <= 0`));
  await writeAudit(tx, systemActor('payment'), {
    action: 'payment.succeeded',
    summary: `${supplier.name} was paid ${money(so.totalPence)} for ${order.number} (invoice ${invoiceNumber}${so.feePence ? `, commission ${money(so.feePence)}` : ''})`,
    entityType: 'supplier_order',
    entityId: so.id,
    showId: so.showId,
    supplierId: so.supplierId,
  });
  return invoiceNumber;
}

/**
 * A payment that was still processing has finished (Connect or platform webhook). Applies it once:
 * the supplier order is locked and only moves on from pending or payment needed.
 */
export async function applyPaymentIntentEvent(paymentIntentId: string, outcome: { succeeded: boolean; chargeId: string | null; message?: string | null }) {
  const db = await getDb();
  const [so] = await db.select().from(supplierOrders).where(eq(supplierOrders.stripePaymentIntentId, paymentIntentId)).limit(1);
  if (!so) return 'ignored' as const;
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, so.supplierId)).limit(1);
  const applied = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(supplierOrders).where(eq(supplierOrders.id, so.id)).for('update').limit(1);
    if (row.status !== 'pending' && row.status !== 'payment_needed') return false;
    if (outcome.succeeded) await markPaid(tx, row, supplier, { paymentIntentId, chargeId: outcome.chargeId });
    else await tx.update(supplierOrders).set({ status: 'payment_needed', paymentError: outcome.message ?? 'The payment didn’t go through. Try again or use another card.' }).where(eq(supplierOrders.id, row.id));
    await refreshOrderStatus(tx, row.orderId);
    if (outcome.succeeded) await enqueue('order_paid', { orderId: row.orderId, supplierOrderIds: [row.id] }, { tx, dedupeKey: `order-paid:${row.id}` });
    return true;
  });
  return applied ? ('applied' as const) : ('duplicate' as const);
}

/**
 * Every ten minutes: supplier orders whose hour has passed without payment are cancelled, so their
 * stock is free again. The items are still in the exhibitor's basket.
 */
export async function releaseExpiredHolds(now = new Date()) {
  const db = await getDb();
  const expired = await db
    .select({ id: supplierOrders.id, orderId: supplierOrders.orderId })
    .from(supplierOrders)
    .innerJoin(orders, eq(orders.id, supplierOrders.orderId))
    .where(and(inArray(supplierOrders.status, ['pending', 'payment_needed']), lt(orders.holdUntil, new Date(now.getTime() - 24 * 3600_000)), sql`(${supplierOrders.stripePaymentIntentId} is null or ${supplierOrders.status} = 'payment_needed')`));
  for (const e of expired) {
    await db.transaction(async (tx) => {
      await tx
        .update(supplierOrders)
        .set({ status: 'cancelled' })
        .where(and(eq(supplierOrders.id, e.id), inArray(supplierOrders.status, ['pending', 'payment_needed'])));
      await refreshOrderStatus(tx, e.orderId, now);
    });
  }
  return expired.length;
}

// ---------------------------------------------------------------------------
// Reading (exhibitor)
// ---------------------------------------------------------------------------

export async function myOrders(actor: Actor, showId: string) {
  await authorize(actor, 'storefront.browse', { showId });
  const ex = actor as ExhibitorActor;
  const db = await getDb();
  return db
    .select()
    .from(orders)
    .where(and(eq(orders.showId, showId), eq(orders.email, ex.email)))
    .orderBy(desc(orders.createdAt));
}

export async function myOrder(actor: Actor, showId: string, orderId: string) {
  await authorize(actor, 'storefront.browse', { showId });
  const db = await getDb();
  const order = await ownOrder(actor as ExhibitorActor, orderId, db);
  return { order, ...(await orderParts(db, orderId)) };
}

/** An order's supplier orders and lines, with each seller's name and invoice details. */
export async function orderParts(db: DbLike, orderId: string) {
  const parts = await db
    .select({ so: supplierOrders, supplierName: suppliers.name, supplierKind: suppliers.kind })
    .from(supplierOrders)
    .innerJoin(suppliers, eq(suppliers.id, supplierOrders.supplierId))
    .where(eq(supplierOrders.orderId, orderId))
    .orderBy(asc(suppliers.kind), asc(suppliers.name));
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId)).orderBy(asc(orderLines.sort));
  return { parts: parts.map((p) => ({ ...p.so, supplierName: p.supplierName, organiser: p.supplierKind === 'organiser', lines: lines.filter((l) => l.supplierOrderId === p.so.id) })) };
}
