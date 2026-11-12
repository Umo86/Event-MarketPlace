import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { auditLog, emailOutbox, files, orders, refunds, stands, supplierOrders, suppliers } from '@/server/db/schema';
import { approveProduct, saveProduct } from '@/server/services/catalogue';
import { createCategory } from '@/server/services/categories';
import { createOrganiserSupplier } from '@/server/services/suppliers';
import { basketFor, chargeOrder, myOrder, placeOrder, releaseExpiredHolds, setBasketQuantity, simulatePayment } from '@/server/services/orders';
import { reconcileRefunds, refundSupplierOrder, refundsForOrder } from '@/server/services/refunds';
import { invoiceFileFor } from '@/server/services/invoices';
import { setCommission } from '@/server/services/catalogue';
import { setPaymentsForTests, SimulatedPayments, type PaymentsProvider } from '@/server/payments/provider';
import { setStorageForTests, MemoryStorage } from '@/server/storage';
import { addExhibitors, addStaff, exhibitorActor, makeShow, makeSupplier } from '../support/factories';

const sim = new SimulatedPayments();

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
  setStorageForTests(new MemoryStorage());
});

afterEach(() => setPaymentsForTests(undefined));

/** A live show with two ready suppliers and Media10's own cleaning, each with one approved product. */
async function shop() {
  setPaymentsForTests(sim);
  const show = await makeShow();
  const showAdmin = await addStaff(show.id, 'show_admin', []);
  const sparks = await makeSupplier();
  const carpets = await makeSupplier();
  const db = await getDb();
  for (const s of [sparks, carpets]) await db.update(suppliers).set({ stripeAccountId: `acct_test${s.supplier.id.replace(/-/g, '').slice(0, 10)}`, stripeChargesEnabled: true }).where(eq(suppliers.id, s.supplier.id));
  const [existing] = await db.select().from(suppliers).where(eq(suppliers.kind, 'organiser'));
  const media10 = existing ?? (await createOrganiserSupplier(sparks.admin, { name: 'Media10 Ltd', contactName: 'Ops', email: 'ops@media10.example.com', vatRegistered: true, invoicePrefix: 'MTEN' }));
  const elec = await createCategory(showAdmin, show.id, { name: 'Electrics', supplierId: sparks.supplier.id });
  const carpet = await createCategory(showAdmin, show.id, { name: 'Carpet', supplierId: carpets.supplier.id });
  const clean = await createCategory(showAdmin, show.id, { name: 'Cleaning', supplierId: media10.id });
  const base = { earlyPrice: '', latePrice: '', vatRateBps: 2000, stockLimit: '', standTypeKeys: [] };
  const socket = await saveProduct(sparks.owner, { showId: show.id, supplierId: sparks.supplier.id, via: 'supplier' }, { ...base, categoryId: elec.id, name: 'Socket', price: '45', stockLimit: '3' });
  const tiles = await saveProduct(carpets.owner, { showId: show.id, supplierId: carpets.supplier.id, via: 'supplier' }, { ...base, categoryId: carpet.id, name: 'Carpet tiles', price: '12.50', unit: 'm²' });
  const nightly = await saveProduct(showAdmin, { showId: show.id, supplierId: media10.id, via: 'organiser' }, { ...base, categoryId: clean.id, name: 'Nightly clean', price: '30' });
  await approveProduct(showAdmin, show.id, socket.id);
  await approveProduct(showAdmin, show.id, tiles.id);
  // 10% commission on the show; electrics at a fixed £2.50 per line.
  await setCommission(showAdmin, show.id, { level: 'show' }, { type: 'percent', value: '10' });
  await setCommission(showAdmin, show.id, { level: 'category', id: elec.id }, { type: 'fixed', value: '2.50' });
  await addExhibitors(show.id, [{ email: 'sam@exhibitor.example.com', stand: 'B12', company: 'Acme Displays' }, { email: 'jo@exhibitor.example.com', stand: 'C4', company: 'Brick & Co' }]);
  const [b12] = await db.select().from(stands).where(and(eq(stands.number, 'B12'), eq(stands.showId, show.id)));
  const [c4] = await db.select().from(stands).where(and(eq(stands.number, 'C4'), eq(stands.showId, show.id)));
  const sam = exhibitorActor(show.id, 'sam@exhibitor.example.com');
  const jo = exhibitorActor(show.id, 'jo@exhibitor.example.com');
  return { show, showAdmin, sparks, carpets, media10, socket, tiles, nightly, b12, c4, sam, jo };
}

async function fill(s: Awaited<ReturnType<typeof shop>>) {
  await setBasketQuantity(s.sam, s.show.id, { standId: s.b12.id, productId: s.socket.id, quantity: 2 });
  await setBasketQuantity(s.sam, s.show.id, { standId: s.b12.id, productId: s.tiles.id, quantity: 9 });
  await setBasketQuantity(s.sam, s.show.id, { standId: s.b12.id, productId: s.nightly.id, quantity: 1 });
}

describe('basket and order', () => {
  it('groups the basket by supplier and prices each line once, with commission from the right level', async () => {
    const s = await shop();
    await fill(s);
    const b = await basketFor(s.sam, s.show.id, s.b12.id);
    expect(b.groups.map((g) => [g.supplierName, g.totalPence])).toEqual([
      [s.carpets.supplier.name, 13500], // 9 × £12.50 = £112.50 + VAT £22.50
      [s.sparks.supplier.name, 10800], // 2 × £45 = £90 + £18
      ['Media10 Ltd', 3600],
    ].sort((a, b) => (a[0] === 'Media10 Ltd' ? 1 : b[0] === 'Media10 Ltd' ? -1 : String(a[0]).localeCompare(String(b[0])))));
    expect(b.totalPence).toBe(27900);
    const order = await placeOrder(s.sam, s.show.id, { standId: s.b12.id, poNumber: 'PO-77' });
    expect(order).toMatchObject({ number: expect.stringMatching(/^ORD-\d{6}$/), totalPence: 27900, poNumber: 'PO-77', standNumber: 'B12', companyName: 'Acme Displays' });
    const { parts } = await myOrder(s.sam, s.show.id, order.id);
    const fee = Object.fromEntries(parts.map((p) => [p.supplierName, [p.feePence, p.chargeAccount === null]]));
    expect(fee[s.sparks.supplier.name]).toEqual([250, false]); // fixed £2.50 on the one line
    expect(fee[s.carpets.supplier.name]).toEqual([1125, false]); // 10% of £112.50
    expect(fee['Media10 Ltd']).toEqual([0, true]); // Media10's own: no fee, own account
  });

  it('holds limited stock for an hour, so nobody else can buy the last one', async () => {
    const s = await shop();
    await setBasketQuantity(s.sam, s.show.id, { standId: s.b12.id, productId: s.socket.id, quantity: 3 });
    await placeOrder(s.sam, s.show.id, { standId: s.b12.id });
    await expect(setBasketQuantity(s.jo, s.show.id, { standId: s.c4.id, productId: s.socket.id, quantity: 1 })).rejects.toThrow(/sold out/);
    // An hour later, unpaid: the stock is free again.
    const later = new Date(Date.now() + 61 * 60_000);
    await setBasketQuantity(s.jo, s.show.id, { standId: s.c4.id, productId: s.socket.id, quantity: 1 }, later);
    await expect(placeOrder(s.jo, s.show.id, { standId: s.c4.id }, later)).resolves.toBeTruthy();
  });

  it('never lets an exhibitor order for someone else’s stand, or see their order', async () => {
    const s = await shop();
    await expect(setBasketQuantity(s.jo, s.show.id, { standId: s.b12.id, productId: s.socket.id, quantity: 1 })).rejects.toMatchObject({ code: 'not_found' });
    await fill(s);
    const order = await placeOrder(s.sam, s.show.id, { standId: s.b12.id });
    await expect(myOrder(s.jo, s.show.id, order.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(simulatePayment(s.jo, s.show.id, order.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('paying: one card, one charge per supplier', () => {
  it('charges each supplier on their own account with the commission as the fee, and Media10 on its own', async () => {
    const s = await shop();
    await fill(s);
    const order = await placeOrder(s.sam, s.show.id, { standId: s.b12.id });
    sim.calls.length = 0;
    const outcomes = await simulatePayment(s.sam, s.show.id, order.id);
    expect(outcomes.map((o) => o.status)).toEqual(['paid', 'paid', 'paid']);
    const charges = sim.calls.filter((c) => c.method === 'charge').map((c) => c.args as { account: string | null; amountPence: number; feePence: number; idempotencyKey: string });
    expect(charges.map((c) => [c.account === null ? 'platform' : 'supplier', c.amountPence, c.feePence]).sort()).toEqual(
      [
        ['platform', 3600, 0],
        ['supplier', 10800, 250],
        ['supplier', 13500, 1125],
      ].sort(),
    );
    const db = await getDb();
    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after.status).toBe('paid');
    // Each seller numbers its own invoices.
    const parts = await db.select().from(supplierOrders).where(eq(supplierOrders.orderId, order.id));
    expect(parts.map((p) => p.invoiceNumber).sort()).toEqual([expect.stringMatching(/^MTEN-INV-000001$|^MTEN-INV-\d{6}$/), expect.stringMatching(/-INV-000001$/), expect.stringMatching(/-INV-000001$/)].sort());
    expect(parts.every((p) => p.invoiceFileId)).toBe(true);
    // The basket is empty, and one confirmation email went with three invoices.
    expect((await basketFor(s.sam, s.show.id, s.b12.id)).count).toBe(0);
    const mail = (await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, 'sam@exhibitor.example.com'))).filter((m) => m.templateKey === 'order_paid');
    expect(mail).toHaveLength(1);
    expect(mail[0].attachmentFileIds).toHaveLength(3);
    // Paying again changes nothing.
    sim.calls.length = 0;
    await expect(simulatePayment(s.sam, s.show.id, order.id)).resolves.toEqual([]);
    expect(sim.calls.filter((c) => c.method === 'charge')).toHaveLength(0);
    // Invoices open for the exhibitor and the supplier only.
    const sparksPart = parts.find((p) => p.supplierId === s.sparks.supplier.id)!;
    expect(await invoiceFileFor(s.sam, sparksPart.invoiceFileId!)).toBeTruthy();
    expect(await invoiceFileFor(s.jo, sparksPart.invoiceFileId!)).toBeNull();
    expect(await invoiceFileFor(s.sparks.owner, sparksPart.invoiceFileId!)).toBeTruthy();
    expect(await invoiceFileFor(s.carpets.owner, sparksPart.invoiceFileId!)).toBeNull();
    expect(await invoiceFileFor(s.showAdmin, sparksPart.invoiceFileId!)).toBeTruthy();
  });

  it('keeps the others paid when one supplier’s charge fails, and lets the exhibitor pay that part again', async () => {
    const s = await shop();
    await fill(s);
    const order = await placeOrder(s.sam, s.show.id, { standId: s.b12.id });
    const outcomes = await simulatePayment(s.sam, s.show.id, order.id, { declineSupplierId: s.carpets.supplier.id });
    expect(Object.fromEntries(outcomes.map((o) => [o.supplierName, o.status]))).toMatchObject({ [s.carpets.supplier.name]: 'payment_needed', [s.sparks.supplier.name]: 'paid', 'Media10 Ltd': 'paid' });
    const { order: o1, parts } = await myOrder(s.sam, s.show.id, order.id);
    expect(o1.status).toBe('part_paid');
    expect(parts.find((p) => p.supplierId === s.carpets.supplier.id)).toMatchObject({ status: 'payment_needed', paymentError: expect.stringMatching(/declined/) });
    // The carpet is still in the basket; the paid items aren't.
    const b = await basketFor(s.sam, s.show.id, s.b12.id);
    expect(b.groups.map((g) => g.supplierName)).toEqual([s.carpets.supplier.name]);
    await simulatePayment(s.sam, s.show.id, order.id);
    expect((await myOrder(s.sam, s.show.id, order.id)).order.status).toBe('paid');
  });

  it('gives up an unpaid part after a day, freeing its stock', async () => {
    const s = await shop();
    await setBasketQuantity(s.sam, s.show.id, { standId: s.b12.id, productId: s.socket.id, quantity: 1 });
    const order = await placeOrder(s.sam, s.show.id, { standId: s.b12.id });
    expect(await releaseExpiredHolds(new Date(Date.now() + 26 * 3600_000))).toBeGreaterThan(0);
    expect((await myOrder(s.sam, s.show.id, order.id)).order.status).toBe('cancelled');
  });

  it('refuses to charge without a saved card', async () => {
    const s = await shop();
    await fill(s);
    const order = await placeOrder(s.sam, s.show.id, { standId: s.b12.id });
    await expect(chargeOrder(order.id)).rejects.toThrow(/no card saved/);
  });
});

describe('refunds and credit notes', () => {
  async function paid() {
    const s = await shop();
    await fill(s);
    const order = await placeOrder(s.sam, s.show.id, { standId: s.b12.id });
    await simulatePayment(s.sam, s.show.id, order.id);
    const db = await getDb();
    const parts = await db.select().from(supplierOrders).where(eq(supplierOrders.orderId, order.id));
    return { ...s, order, part: (id: string) => parts.find((p) => p.supplierId === id)! };
  }

  it('refunds part of a supplier order on their account with the fee returned, and makes a credit note', async () => {
    const s = await paid();
    const part = s.part(s.carpets.supplier.id);
    sim.calls.length = 0;
    await refundSupplierOrder(s.carpets.owner, { supplierOrderId: part.id, amountPence: 2700, reason: 'Two m² not laid' }, 'supplier');
    const call = sim.calls.find((c) => c.method === 'refund')!.args as { account: string; amountPence: number; refundApplicationFee: boolean };
    expect(call).toMatchObject({ account: part.chargeAccount, amountPence: 2700, refundApplicationFee: true });
    const db = await getDb();
    const [after] = await db.select().from(supplierOrders).where(eq(supplierOrders.id, part.id));
    expect(after).toMatchObject({ status: 'part_refunded', refundedPence: 2700, feeRefundedPence: 225 }); // 1125 × 2700 / 13500
    const [r] = await refundsForOrder(s.order.id);
    expect(r).toMatchObject({ status: 'succeeded', creditNoteNumber: expect.stringMatching(/-CRN-000001$/), creditNoteFileId: expect.any(String) });
    const [pdf] = await db.select().from(files).where(eq(files.id, r.creditNoteFileId!));
    expect(pdf.mimeType).toBe('application/pdf');
    // Never more than is left.
    await expect(refundSupplierOrder(s.carpets.owner, { supplierOrderId: part.id, amountPence: 20000, reason: 'Too much' }, 'supplier')).rejects.toThrow(/more than is left/);
    // Another supplier can't refund it; staff without the right can't either.
    await expect(refundSupplierOrder(s.sparks.owner, { supplierOrderId: part.id, amountPence: 100, reason: 'Not mine' }, 'supplier')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('lets a show admin refund on the supplier’s behalf: audited with the reason, and the supplier emailed', async () => {
    const s = await paid();
    const part = s.part(s.sparks.supplier.id);
    const line = (await myOrder(s.sam, s.show.id, s.order.id)).parts.find((p) => p.id === part.id)!.lines[0];
    await refundSupplierOrder(s.showAdmin, { supplierOrderId: part.id, lineAmounts: { [line.id]: line.totalPence }, reason: 'Sockets never arrived' }, 'show');
    const db = await getDb();
    const [after] = await db.select().from(supplierOrders).where(eq(supplierOrders.id, part.id));
    expect(after.status).toBe('refunded');
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'refund.by_media10'));
    expect(audit.some((a) => a.summary.includes('Sockets never arrived'))).toBe(true);
    const toSupplier = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, s.sparks.owner.email));
    expect(toSupplier.some((m) => m.templateKey === 'refund_by_media10')).toBe(true);
    const toExhibitor = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, 'sam@exhibitor.example.com'));
    expect(toExhibitor.filter((m) => m.templateKey === 'refund_made' && m.showId === s.show.id)).toHaveLength(1);
    // A team member without the Refunds right can't.
    const team = await addStaff(s.show.id, 'show_team', ['orders']);
    await expect(refundSupplierOrder(team, { supplierOrderId: s.part(s.carpets.supplier.id).id, amountPence: 100, reason: 'Trying' }, 'show')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('two refunds started at once never give back the same money', async () => {
    const s = await paid();
    const part = s.part(s.carpets.supplier.id);
    const results = await Promise.allSettled([
      refundSupplierOrder(s.carpets.owner, { supplierOrderId: part.id, amountPence: 10000, reason: 'First go' }, 'supplier'),
      refundSupplierOrder(s.carpets.owner, { supplierOrderId: part.id, amountPence: 10000, reason: 'Second go' }, 'supplier'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const db = await getDb();
    const [after] = await db.select().from(supplierOrders).where(eq(supplierOrders.id, part.id));
    expect(after.refundedPence).toBe(10000);
  });

  it('picks up a refund made in the supplier’s own Stripe dashboard, once', async () => {
    const s = await paid();
    const part = s.part(s.carpets.supplier.id);
    const fake = Object.assign(new SimulatedPayments(), {
      listRefunds: async () => [{ id: 're_dashboard_1', amountPence: 1350, status: 'succeeded' as const, created: 1 }],
    });
    setPaymentsForTests(fake as unknown as PaymentsProvider);
    expect(await reconcileRefunds(part.chargeAccount, part.stripePaymentIntentId!)).toBe(1);
    expect(await reconcileRefunds(part.chargeAccount, part.stripePaymentIntentId!)).toBe(0);
    const db = await getDb();
    const rows = await db.select().from(refunds).where(eq(refunds.supplierOrderId, part.id));
    expect(rows).toMatchObject([{ source: 'stripe', amountPence: 1350, status: 'succeeded', creditNoteNumber: expect.stringMatching(/-CRN-/) }]);
  });
});
