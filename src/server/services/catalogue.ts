import 'server-only';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type DbLike } from '../db/client';
import { products, showCategories, shows, standTypes, suppliers, type ProductChange } from '../db/schema';
import { authorize } from '../authz';
import { invalid, notFound } from '../errors';
import { writeAudit } from '../audit';
import { storeImage } from './files';
import { putSetting, getSetting } from './settings';
import { heldQuantities } from './stock';
import { parsePounds, priceFor, vatOn } from '@/lib/pricing';
import { money, percentFromBps } from '@/lib/format';
import type { Actor, UserActor } from '../auth/actor';

/**
 * Products and price approval. Suppliers add products to the categories they serve at a show; a
 * show admin approves each new product, and each change to what exhibitors see (name,
 * description, image, prices, VAT). Until then exhibitors see nothing new, or the approved version.
 * Media10's own services are edited by show admins and need no approval.
 */

const UUID = /^[0-9a-f-]{36}$/i;
export const VAT_RATES = [2000, 500, 0] as const;

const pounds = (label: string, required: boolean) =>
  z
    .string()
    .trim()
    .max(20)
    .transform((v, ctx) => {
      if (!v) {
        if (required) ctx.addIssue({ code: 'custom', message: `Enter the ${label}.` });
        return null;
      }
      const p = parsePounds(v);
      if (p === null) {
        ctx.addIssue({ code: 'custom', message: 'Enter a price in pounds, such as 45 or 45.50.' });
        return null;
      }
      return p;
    });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

export const productSchema = z.object({
  categoryId: z.string().uuid('Choose a category.'),
  name: z.string().trim().min(2, 'Give the product a name.').max(120, 'Keep the name under 120 characters.'),
  code: optionalText(40),
  description: optionalText(1000),
  unit: z.string().trim().min(1).max(30).default('each'),
  price: pounds('price', true),
  earlyPrice: pounds('early-bird price', false),
  latePrice: pounds('late price', false),
  vatRateBps: z.coerce.number().pipe(z.union(VAT_RATES.map((r) => z.literal(r)) as unknown as [z.ZodLiteral<2000>, z.ZodLiteral<500>, z.ZodLiteral<0>])),
  stockLimit: z
    .string()
    .trim()
    .max(7)
    .transform((v, ctx) => {
      if (!v) return null;
      if (!/^\d+$/.test(v)) {
        ctx.addIssue({ code: 'custom', message: 'Enter a whole number, or leave it empty for no limit.' });
        return null;
      }
      return Number(v);
    }),
  standTypeKeys: z.array(z.string().max(40)).max(20).default([]),
});

export type ProductInput = z.input<typeof productSchema>;
export type ProductRow = typeof products.$inferSelect;

function changeOf(p: Pick<ProductRow, 'name' | 'description' | 'imageFileId' | 'pricePence' | 'earlyPricePence' | 'latePricePence' | 'vatRateBps'>): ProductChange {
  return { name: p.name, description: p.description, imageFileId: p.imageFileId, pricePence: p.pricePence, earlyPricePence: p.earlyPricePence, latePricePence: p.latePricePence, vatRateBps: p.vatRateBps };
}

function sameChange(a: ProductChange, b: ProductChange) {
  return (Object.keys(a) as (keyof ProductChange)[]).every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/** "£45.00 → £50.00, new image" for the audit log and the approval list. */
export function describeChange(before: ProductChange, after: ProductChange): string[] {
  const out: string[] = [];
  if (before.name !== after.name) out.push(`name “${before.name}” → “${after.name}”`);
  if (before.pricePence !== after.pricePence) out.push(`price ${money(before.pricePence)} → ${money(after.pricePence)}`);
  if (before.earlyPricePence !== after.earlyPricePence) out.push(`early-bird price ${before.earlyPricePence === null ? 'none' : money(before.earlyPricePence)} → ${after.earlyPricePence === null ? 'none' : money(after.earlyPricePence)}`);
  if (before.latePricePence !== after.latePricePence) out.push(`late price ${before.latePricePence === null ? 'none' : money(before.latePricePence)} → ${after.latePricePence === null ? 'none' : money(after.latePricePence)}`);
  if (before.vatRateBps !== after.vatRateBps) out.push(`VAT ${percentFromBps(before.vatRateBps)} → ${percentFromBps(after.vatRateBps)}`);
  if ((before.description ?? '') !== (after.description ?? '')) out.push('description changed');
  if (before.imageFileId !== after.imageFileId) out.push(after.imageFileId ? 'new image' : 'image removed');
  return out;
}

async function categoryFor(db: DbLike, showId: string, categoryId: string) {
  const [row] = await db
    .select({ id: showCategories.id, name: showCategories.name, supplierId: showCategories.supplierId, supplierKind: suppliers.kind })
    .from(showCategories)
    .leftJoin(suppliers, eq(suppliers.id, showCategories.supplierId))
    .where(and(eq(showCategories.id, categoryId), eq(showCategories.showId, showId)))
    .limit(1);
  return row ?? null;
}

async function checkStandTypes(db: DbLike, showId: string, keys: string[]) {
  if (!keys.length) return [];
  const rows = await db.select({ key: standTypes.key }).from(standTypes).where(eq(standTypes.showId, showId));
  const known = new Set(rows.map((r) => r.key));
  const unique = [...new Set(keys)];
  if (unique.some((k) => !known.has(k))) throw invalid('One of those stand types isn’t on this show. Choose again.', { standTypeKeys: 'Choose stand types from the list.' });
  return unique;
}

type Image = { bytes: Uint8Array; name: string } | null;

/**
 * Adds or changes a product. `via: 'supplier'` is the supplier's own panel (changes wait for
 * approval); `via: 'organiser'` is a show admin looking after Media10's own services (live at once).
 */
export async function saveProduct(
  actor: UserActor,
  target: { showId: string; supplierId: string; productId?: string | null; via: 'supplier' | 'organiser' },
  raw: ProductInput,
  image: Image = null,
  opts: { removeImage?: boolean } = {},
): Promise<ProductRow> {
  const input = productSchema.parse(raw);
  if (target.via === 'supplier') await authorize(actor, 'supplier.catalogue.edit', { supplierId: target.supplierId }, { write: true });
  else await authorize(actor, 'categories.manage', { showId: target.showId }, { write: true });
  if (!UUID.test(target.showId) || !UUID.test(target.supplierId) || (target.productId && !UUID.test(target.productId))) throw notFound();
  const db = await getDb();
  const category = await categoryFor(db, target.showId, input.categoryId);
  if (!category || category.supplierId !== target.supplierId) throw invalid('You don’t supply that category at this show. Choose one of yours.', { categoryId: 'Choose one of your categories.' });
  if (target.via === 'organiser' && category.supplierKind !== 'organiser') throw notFound();
  if (target.via === 'supplier' && category.supplierKind === 'organiser') throw notFound();
  const [seller] = await db.select({ vatRegistered: suppliers.vatRegistered }).from(suppliers).where(eq(suppliers.id, target.supplierId)).limit(1);
  if (seller && !seller.vatRegistered && input.vatRateBps !== 0) throw invalid('You’re not VAT registered, so you can’t charge VAT. Choose 0%.', { vatRateBps: 'Choose 0%: you’re not VAT registered.' });
  if (input.earlyPrice !== null && input.earlyPrice > input.price!) throw invalid('The early-bird price is usually lower than the standard price. Check it.', { earlyPrice: 'Higher than the standard price.' });
  const keys = await checkStandTypes(db, target.showId, input.standTypeKeys);
  const stored = image ? await storeImage(actor, { bytes: image.bytes, name: image.name, purpose: 'product', showId: target.showId, supplierId: target.supplierId, isPublic: true, allowed: ['png', 'jpeg'], maxBytes: 2 * 1024 * 1024 }) : null;
  const autoApprove = target.via === 'organiser';

  return db.transaction(async (tx) => {
    const existing = target.productId
      ? (
          await tx
            .select()
            .from(products)
            .where(and(eq(products.id, target.productId), eq(products.showId, target.showId), eq(products.supplierId, target.supplierId)))
            .for('update')
            .limit(1)
        )[0]
      : undefined;
    if (target.productId && !existing) throw notFound();
    const imageFileId = stored ? stored.id : opts.removeImage ? null : (existing?.pendingChange?.imageFileId ?? existing?.imageFileId ?? null);
    const wanted: ProductChange = {
      name: input.name,
      description: input.description ?? null,
      imageFileId,
      pricePence: input.price!,
      earlyPricePence: input.earlyPrice,
      latePricePence: input.latePrice,
      vatRateBps: input.vatRateBps,
    };
    const direct = { categoryId: category.id, code: input.code ?? null, unit: input.unit, stockLimit: input.stockLimit, standTypeKeys: keys };
    const now = new Date();

    if (!existing) {
      const [row] = await tx
        .insert(products)
        .values({ showId: target.showId, supplierId: target.supplierId, ...direct, ...wanted, status: autoApprove ? 'live' : 'pending', submittedAt: now, createdBy: actor.userId, ...(autoApprove ? { approvedAt: now, reviewedBy: actor.userId, reviewedAt: now } : {}) })
        .returning();
      await writeAudit(tx, actor, {
        action: 'product.created',
        summary: `Added ${row.name} at ${money(row.pricePence)} to ${category.name}${autoApprove ? '' : ', waiting for approval'}`,
        entityType: 'product',
        entityId: row.id,
        showId: target.showId,
        supplierId: target.supplierId,
      });
      return row;
    }

    // Not yet approved (or turned down): the supplier simply edits it and it goes back for approval.
    if (existing.status === 'archived' && !autoApprove) throw invalid('This product is off sale. Put it back on sale first, then change it.');
    if (existing.status !== 'live' || autoApprove) {
      const [row] = await tx
        .update(products)
        .set({
          ...direct,
          ...wanted,
          pendingChange: null,
          rejectionReason: null,
          status: autoApprove ? (existing.status === 'archived' ? 'archived' : 'live') : 'pending',
          submittedAt: now,
          ...(autoApprove ? { approvedAt: existing.approvedAt ?? now, reviewedBy: actor.userId, reviewedAt: now } : {}),
        })
        .where(eq(products.id, existing.id))
        .returning();
      await writeAudit(tx, actor, {
        action: 'product.updated',
        summary: `Changed ${row.name}${autoApprove ? '' : existing.status === 'rejected' ? ' and sent it for approval again' : ''}`,
        entityType: 'product',
        entityId: row.id,
        showId: target.showId,
        supplierId: target.supplierId,
        details: { changes: describeChange(changeOf(existing), wanted) },
      });
      return row;
    }

    // Live: exhibitors keep the approved version until a show admin approves the change.
    const live = changeOf(existing);
    const pending = sameChange(live, wanted) ? null : wanted;
    const [row] = await tx
      .update(products)
      .set({ ...direct, pendingChange: pending, submittedAt: pending ? now : existing.submittedAt, rejectionReason: pending ? null : existing.rejectionReason })
      .where(eq(products.id, existing.id))
      .returning();
    await writeAudit(tx, actor, {
      action: pending ? 'product.change_submitted' : 'product.updated',
      summary: pending ? `Asked to change ${existing.name}: ${describeChange(live, wanted).join(', ')}` : `Changed ${existing.name}’s details`,
      entityType: 'product',
      entityId: row.id,
      showId: target.showId,
      supplierId: target.supplierId,
    });
    return row;
  });
}

/** Hides a product from exhibitors at once (no approval needed), or brings it back. */
export async function setProductArchived(actor: UserActor, target: { showId: string; supplierId: string; productId: string; via: 'supplier' | 'organiser' }, archived: boolean) {
  if (target.via === 'supplier') await authorize(actor, 'supplier.catalogue.edit', { supplierId: target.supplierId }, { write: true });
  else await authorize(actor, 'categories.manage', { showId: target.showId }, { write: true });
  if (!UUID.test(target.productId)) throw notFound();
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, target.productId), eq(products.showId, target.showId), eq(products.supplierId, target.supplierId)))
      .for('update')
      .limit(1);
    if (!p) throw notFound();
    // Bringing back something never approved sends it for approval; an approved one goes straight back on sale.
    const next = archived ? 'archived' : p.approvedAt ? 'live' : 'pending';
    await tx.update(products).set({ status: next }).where(eq(products.id, p.id));
    await writeAudit(tx, actor, { action: archived ? 'product.archived' : 'product.restored', summary: archived ? `Took ${p.name} off sale` : `Put ${p.name} back on sale`, entityType: 'product', entityId: p.id, showId: target.showId, supplierId: target.supplierId });
  });
}

// ---------------------------------------------------------------------------
// Show admins: approval and commission
// ---------------------------------------------------------------------------

export async function approveProduct(actor: UserActor, showId: string, productId: string) {
  await authorize(actor, 'products.approve', { showId }, { write: true });
  if (!UUID.test(productId)) throw notFound();
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.showId, showId)))
      .for('update')
      .limit(1);
    if (!p) throw notFound();
    const now = new Date();
    if (p.status === 'pending') {
      await tx.update(products).set({ status: 'live', rejectionReason: null, approvedAt: now, reviewedBy: actor.userId, reviewedAt: now }).where(eq(products.id, p.id));
      await writeAudit(tx, actor, { action: 'product.approved', summary: `Approved ${p.name} at ${money(p.pricePence)}`, entityType: 'product', entityId: p.id, showId, supplierId: p.supplierId });
      return;
    }
    if (p.pendingChange) {
      const c = p.pendingChange;
      await tx
        .update(products)
        .set({ ...c, pendingChange: null, rejectionReason: null, reviewedBy: actor.userId, reviewedAt: now })
        .where(eq(products.id, p.id));
      await writeAudit(tx, actor, {
        action: 'product.change_approved',
        summary: `Approved a change to ${p.name}: ${describeChange(changeOf(p), c).join(', ')}`,
        entityType: 'product',
        entityId: p.id,
        showId,
        supplierId: p.supplierId,
      });
      return;
    }
    throw invalid('There’s nothing waiting for approval on that product.');
  });
}

export async function rejectProduct(actor: UserActor, showId: string, productId: string, reason: string) {
  await authorize(actor, 'products.approve', { showId }, { write: true });
  const why = reason.trim();
  if (why.length < 3) throw invalid('Say why, so the supplier knows what to change. They’ll see this.', { reason: 'Give a reason.' });
  if (!UUID.test(productId)) throw notFound();
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.showId, showId)))
      .for('update')
      .limit(1);
    if (!p) throw notFound();
    const now = new Date();
    if (p.status === 'pending') {
      await tx.update(products).set({ status: 'rejected', rejectionReason: why.slice(0, 500), reviewedBy: actor.userId, reviewedAt: now }).where(eq(products.id, p.id));
    } else if (p.pendingChange) {
      // The approved version stays on sale; the change is dropped.
      await tx.update(products).set({ pendingChange: null, rejectionReason: why.slice(0, 500), reviewedBy: actor.userId, reviewedAt: now }).where(eq(products.id, p.id));
    } else throw invalid('There’s nothing waiting for approval on that product.');
    await writeAudit(tx, actor, { action: 'product.rejected', summary: `Turned down ${p.status === 'pending' ? p.name : `a change to ${p.name}`}: ${why}`, entityType: 'product', entityId: p.id, showId, supplierId: p.supplierId });
  });
}

/** "10" or "12.5" (%) → basis points; "2.50" (£) → pence. Null clears it. */
export const commissionSchema = z
  .object({ type: z.enum(['percent', 'fixed']).nullable(), value: z.string().trim().max(12) })
  .transform((v, ctx) => {
    if (!v.type) return { type: null, value: null };
    if (v.type === 'percent') {
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(v.value) || Number(v.value) > 100) {
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a percentage from 0 to 100, such as 10 or 12.5.' });
        return z.NEVER;
      }
      return { type: 'percent' as const, value: Math.round(Number(v.value) * 100) };
    }
    const p = parsePounds(v.value);
    if (p === null) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter an amount in pounds, such as 2.50.' });
      return z.NEVER;
    }
    return { type: 'fixed' as const, value: p };
  });

export type CommissionInput = z.input<typeof commissionSchema>;

function commissionText(c: { type: 'percent' | 'fixed' | null; value: number | null }) {
  if (!c.type || c.value === null) return 'not set (falls back)';
  return c.type === 'percent' ? percentFromBps(c.value) : `${money(c.value)} per line`;
}

/** Commission for a show, one of its categories, or one of its products. Show admins only. */
export async function setCommission(actor: UserActor, showId: string, on: { level: 'show' } | { level: 'category'; id: string } | { level: 'product'; id: string }, raw: CommissionInput) {
  const c = commissionSchema.parse(raw);
  await authorize(actor, 'commission.manage', { showId }, { write: true });
  const db = await getDb();
  await db.transaction(async (tx) => {
    let what = 'the show';
    if (on.level === 'show') {
      const [row] = await tx.update(shows).set({ commissionType: c.type, commissionValue: c.value }).where(eq(shows.id, showId)).returning({ name: shows.name });
      if (!row) throw notFound();
    } else if (on.level === 'category') {
      if (!UUID.test(on.id)) throw notFound();
      const [row] = await tx
        .update(showCategories)
        .set({ commissionType: c.type, commissionValue: c.value })
        .where(and(eq(showCategories.id, on.id), eq(showCategories.showId, showId)))
        .returning({ name: showCategories.name });
      if (!row) throw notFound();
      what = `the category ${row.name}`;
    } else {
      if (!UUID.test(on.id)) throw notFound();
      const [row] = await tx
        .update(products)
        .set({ commissionType: c.type, commissionValue: c.value })
        .where(and(eq(products.id, on.id), eq(products.showId, showId)))
        .returning({ name: products.name });
      if (!row) throw notFound();
      what = row.name;
    }
    await writeAudit(tx, actor, { action: 'commission.set', summary: `Set commission on ${what}: ${commissionText(c)}`, entityType: on.level, entityId: on.level === 'show' ? showId : on.id, showId, details: c });
  });
}

/** A supplier's commission at every show. Super admins only. */
export async function setSupplierCommission(actor: UserActor, supplierId: string, raw: CommissionInput) {
  const c = commissionSchema.parse(raw);
  await authorize(actor, 'suppliers.manage', {}, { write: true });
  if (!UUID.test(supplierId)) throw notFound();
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx.update(suppliers).set({ commissionType: c.type, commissionValue: c.value }).where(eq(suppliers.id, supplierId)).returning({ name: suppliers.name });
    if (!row) throw notFound();
    await writeAudit(tx, actor, { action: 'commission.set', summary: `Set ${row.name}’s commission: ${commissionText(c)}`, entityType: 'supplier', entityId: supplierId, supplierId, details: c });
  });
}

/** The platform default. Super admins only. */
export async function setDefaultCommission(actor: UserActor, raw: CommissionInput) {
  const c = commissionSchema.parse(raw);
  await authorize(actor, 'platform.settings.edit', {}, { write: true });
  if (!c.type || c.value === null) throw invalid('The platform needs a default. Enter 0 for none.', { value: 'Enter a default.' });
  const db = await getDb();
  await db.transaction(async (tx) => {
    await putSetting(tx, 'commissionDefault', { type: c.type!, value: c.value! }, actor.userId);
    await writeAudit(tx, actor, { action: 'commission.set', summary: `Set the platform’s default commission: ${commissionText(c)}`, entityType: 'platform' });
  });
}

export async function defaultCommission() {
  return getSetting('commissionDefault');
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const productColumns = {
  product: products,
  categoryName: showCategories.name,
  categorySort: showCategories.sort,
  supplierName: suppliers.name,
  supplierKind: suppliers.kind,
};

/** What a supplier sells at a show, with the categories it may add to. */
export async function supplierCatalogue(actor: Actor, supplierId: string, showId: string) {
  await authorize(actor, 'supplier.view', { supplierId });
  if (!UUID.test(showId)) throw notFound();
  const db = await getDb();
  const categories = await db
    .select({ id: showCategories.id, name: showCategories.name })
    .from(showCategories)
    .where(and(eq(showCategories.showId, showId), eq(showCategories.supplierId, supplierId)))
    .orderBy(asc(showCategories.sort));
  if (!categories.length) throw notFound();
  const [show] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1);
  const rows = await db
    .select(productColumns)
    .from(products)
    .innerJoin(showCategories, eq(showCategories.id, products.categoryId))
    .innerJoin(suppliers, eq(suppliers.id, products.supplierId))
    .where(and(eq(products.showId, showId), eq(products.supplierId, supplierId)))
    .orderBy(asc(showCategories.sort), asc(products.sort), asc(sql`lower(${products.name})`));
  const types = await db.select({ key: standTypes.key, name: standTypes.name }).from(standTypes).where(eq(standTypes.showId, showId)).orderBy(asc(standTypes.sort));
  return { show, categories, standTypes: types, products: rows };
}

/** Every product at a show, for show admins: what's waiting for approval first. */
export async function showProducts(actor: Actor, showId: string) {
  await authorize(actor, 'show.view', { showId });
  const db = await getDb();
  const rows = await db
    .select(productColumns)
    .from(products)
    .innerJoin(showCategories, eq(showCategories.id, products.categoryId))
    .innerJoin(suppliers, eq(suppliers.id, products.supplierId))
    .where(eq(products.showId, showId))
    .orderBy(asc(showCategories.sort), asc(products.sort), asc(sql`lower(${products.name})`));
  const types = await db.select({ key: standTypes.key, name: standTypes.name }).from(standTypes).where(eq(standTypes.showId, showId)).orderBy(asc(standTypes.sort));
  return { products: rows, standTypes: types, waiting: rows.filter((r) => r.product.status === 'pending' || r.product.pendingChange) };
}

/** How many products are waiting for approval at each of these shows (for menus and badges). */
export async function waitingCounts(showIds: string[]) {
  if (!showIds.length) return new Map<string, number>();
  const db = await getDb();
  const rows = await db
    .select({ showId: products.showId, n: sql<number>`count(*)::int` })
    .from(products)
    .where(and(inArray(products.showId, showIds), sql`(${products.status} = 'pending' or ${products.pendingChange} is not null)`))
    .groupBy(products.showId);
  return new Map(rows.map((r) => [r.showId, Number(r.n)]));
}

export type StorefrontProduct = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  imageFileId: string | null;
  unit: string;
  unitPence: number;
  band: 'early' | 'standard' | 'late';
  standardPence: number;
  vatRateBps: number;
  vatPence: number;
  stockLeft: number | null;
  categoryId: string;
  supplierName: string;
};

/**
 * Live products exhibitors can order for one stand type: only in categories whose supplier is ready
 * to sell, only from the category's current supplier, at today's price. Stock left counts paid
 * orders and orders still being paid for (held for an hour).
 */
export async function storefrontProducts(actor: Actor, showId: string, standTypeKey: string | null, opts: { categoryId?: string; now?: Date; db?: DbLike } = {}) {
  await authorize(actor, 'storefront.browse', { showId });
  const db = opts.db ?? (await getDb());
  const [show] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1);
  if (!show) throw notFound();
  const rows = await db
    .select({ p: products, supplierName: suppliers.name, categoryName: showCategories.name, categorySort: showCategories.sort })
    .from(products)
    .innerJoin(showCategories, and(eq(showCategories.id, products.categoryId), eq(showCategories.supplierId, products.supplierId)))
    .innerJoin(suppliers, eq(suppliers.id, products.supplierId))
    .where(
      and(
        eq(products.showId, showId),
        eq(products.status, 'live'),
        sql`${suppliers.pausedAt} is null`,
        sql`(${suppliers.kind} = 'organiser' or ${suppliers.stripeChargesEnabled})`,
        opts.categoryId ? eq(products.categoryId, opts.categoryId) : undefined,
        standTypeKey ? sql`(jsonb_array_length(${products.standTypeKeys}) = 0 or ${products.standTypeKeys} ? ${standTypeKey})` : sql`jsonb_array_length(${products.standTypeKeys}) = 0`,
      ),
    )
    .orderBy(asc(showCategories.sort), asc(products.sort), asc(sql`lower(${products.name})`));
  const held = await heldQuantities(
    rows.filter((r) => r.p.stockLimit !== null).map((r) => r.p.id),
    { now: opts.now, db },
  );
  return rows.map(({ p, supplierName }): StorefrontProduct => {
    const price = priceFor(p, show, opts.now);
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      description: p.description,
      imageFileId: p.imageFileId,
      unit: p.unit,
      unitPence: price.unitPence,
      band: price.band,
      standardPence: p.pricePence,
      vatRateBps: p.vatRateBps,
      vatPence: vatOn(price.unitPence, p.vatRateBps),
      stockLeft: p.stockLimit === null ? null : Math.max(0, p.stockLimit - (held.get(p.id) ?? 0)),
      categoryId: p.categoryId,
      supplierName,
    };
  });
}

/** Plain rows for the product editor. */
export function editorProducts(rows: { product: ProductRow; categoryName: string }[]) {
  return rows.map(({ product: p, categoryName }) => ({
    id: p.id,
    categoryId: p.categoryId,
    categoryName,
    name: p.name,
    code: p.code,
    description: p.description,
    imageFileId: p.imageFileId,
    unit: p.unit,
    pricePence: p.pricePence,
    earlyPricePence: p.earlyPricePence,
    latePricePence: p.latePricePence,
    vatRateBps: p.vatRateBps,
    stockLimit: p.stockLimit,
    standTypeKeys: p.standTypeKeys,
    status: p.status,
    pendingChange: p.pendingChange ?? null,
    rejectionReason: p.rejectionReason,
  }));
}
