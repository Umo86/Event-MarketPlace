import 'server-only';
import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { showCategories, shows, suppliers } from '../db/schema';
import { authorize } from '../authz';
import { invalid, notFound } from '../errors';
import { writeAudit } from '../audit';
import { supplierStatus, type SupplierStatus } from '@/lib/supplier-status';
import type { Actor, UserActor } from '../auth/actor';

/**
 * A show's categories and the one supplier that serves each ("Electrics: Sparks Ltd" for UKCW
 * London). Show admins look after them. Suppliers belong to the platform; a show only picks which
 * one serves each of its categories.
 */

export const categorySchema = z.object({
  name: z.string().trim().min(2, 'Give the category a name, such as Electrics.').max(80, 'Keep the name under 80 characters.'),
  description: z
    .string()
    .trim()
    .max(300, 'Keep this under 300 characters.')
    .transform((v) => v || null)
    .nullish(),
  supplierId: z.string().uuid().nullish(),
});

export type CategoryInput = z.input<typeof categorySchema>;

const UUID = /^[0-9a-f-]{36}$/i;

/** Ready to sell, worked out in SQL the same way as src/lib/supplier-status.ts. */
const sellable = and(isNull(suppliers.pausedAt), or(eq(suppliers.kind, 'organiser'), eq(suppliers.stripeChargesEnabled, true)));

async function checkSupplier(supplierId: string | null | undefined) {
  if (!supplierId) return null;
  const db = await getDb();
  const [row] = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!row) throw invalid('That supplier no longer exists. Choose another.', { supplierId: 'Choose a supplier from the list.' });
  return row;
}

function isNameClash(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string; constraint?: string }; constraint?: string } | null;
  const code = e?.code ?? e?.cause?.code;
  return code === '23505';
}

/** A show's categories with who supplies each. Anyone on the show's team can see them. */
export async function listCategories(actor: Actor, showId: string) {
  await authorize(actor, 'show.view', { showId });
  const db = await getDb();
  const rows = await db
    .select({
      id: showCategories.id,
      name: showCategories.name,
      description: showCategories.description,
      sort: showCategories.sort,
      supplierId: showCategories.supplierId,
      supplierName: suppliers.name,
      supplierKind: suppliers.kind,
      pausedAt: suppliers.pausedAt,
      chargesEnabled: suppliers.stripeChargesEnabled,
    })
    .from(showCategories)
    .leftJoin(suppliers, eq(suppliers.id, showCategories.supplierId))
    .where(eq(showCategories.showId, showId))
    .orderBy(asc(showCategories.sort), asc(sql`lower(${showCategories.name})`));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    supplier: r.supplierId
      ? {
          id: r.supplierId,
          name: r.supplierName!,
          kind: r.supplierKind!,
          // "Invited" and "Stripe pending" both mean "can't sell yet" here, so sign-ins aren't looked up.
          status: supplierStatus({ kind: r.supplierKind!, pausedAt: r.pausedAt, stripeChargesEnabled: Boolean(r.chargesEnabled), anyoneSignedIn: true }) as SupplierStatus,
        }
      : null,
  }));
}

/** Suppliers a show admin can choose from: every supplier, with whether they can sell yet. */
export async function assignableSuppliers(actor: Actor, showId: string) {
  await authorize(actor, 'categories.manage', { showId });
  const db = await getDb();
  const rows = await db
    .select({ id: suppliers.id, name: suppliers.name, kind: suppliers.kind, pausedAt: suppliers.pausedAt, chargesEnabled: suppliers.stripeChargesEnabled })
    .from(suppliers)
    .orderBy(asc(suppliers.kind), asc(sql`lower(${suppliers.name})`));
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, status: supplierStatus({ kind: r.kind, pausedAt: r.pausedAt, stripeChargesEnabled: r.chargesEnabled, anyoneSignedIn: true }) }));
}

export async function createCategory(actor: UserActor, showId: string, raw: CategoryInput) {
  const input = categorySchema.parse(raw);
  await authorize(actor, 'categories.manage', { showId }, { write: true });
  const supplier = await checkSupplier(input.supplierId);
  const db = await getDb();
  try {
    return await db.transaction(async (tx) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${showCategories.sort}), -1) + 1` })
        .from(showCategories)
        .where(eq(showCategories.showId, showId));
      const [row] = await tx
        .insert(showCategories)
        .values({ showId, name: input.name, description: input.description ?? null, supplierId: supplier?.id ?? null, sort: Number(next) })
        .returning();
      await writeAudit(tx, actor, {
        action: 'category.created',
        summary: `Added the category ${row.name}${supplier ? `, supplied by ${supplier.name}` : ''}`,
        entityType: 'category',
        entityId: row.id,
        showId,
        supplierId: supplier?.id ?? null,
      });
      return row;
    });
  } catch (err) {
    if (isNameClash(err)) throw invalid('This show already has a category with that name.', { name: 'This show already has a category with that name.' });
    throw err;
  }
}

/** Renames a category, changes its description, or changes who supplies it. */
export async function updateCategory(actor: UserActor, showId: string, categoryId: string, raw: CategoryInput) {
  const input = categorySchema.parse(raw);
  await authorize(actor, 'categories.manage', { showId }, { write: true });
  if (!UUID.test(categoryId)) throw notFound();
  const supplier = await checkSupplier(input.supplierId);
  const db = await getDb();
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(showCategories)
        .where(and(eq(showCategories.id, categoryId), eq(showCategories.showId, showId)))
        .for('update')
        .limit(1);
      if (!before) throw notFound();
      await tx
        .update(showCategories)
        .set({ name: input.name, description: input.description ?? null, supplierId: supplier?.id ?? null })
        .where(eq(showCategories.id, categoryId));
      const changes: string[] = [];
      if (before.name !== input.name) changes.push(`renamed from ${before.name}`);
      if ((before.supplierId ?? null) !== (supplier?.id ?? null)) changes.push(supplier ? `now supplied by ${supplier.name}` : 'no supplier now');
      if ((before.description ?? null) !== (input.description ?? null)) changes.push('description changed');
      await writeAudit(tx, actor, {
        action: (before.supplierId ?? null) !== (supplier?.id ?? null) ? 'category.supplier_changed' : 'category.updated',
        summary: `Changed the category ${input.name}${changes.length ? `: ${changes.join(', ')}` : ''}`,
        entityType: 'category',
        entityId: categoryId,
        showId,
        supplierId: supplier?.id ?? before.supplierId ?? null,
        details: { previousSupplierId: before.supplierId, supplierId: supplier?.id ?? null },
      });
    });
  } catch (err) {
    if (isNameClash(err)) throw invalid('This show already has a category with that name.', { name: 'This show already has a category with that name.' });
    throw err;
  }
}

/** Removes a category. From phase 2, a category with products or orders can't be removed. */
export async function deleteCategory(actor: UserActor, showId: string, categoryId: string) {
  await authorize(actor, 'categories.manage', { showId }, { write: true });
  if (!UUID.test(categoryId)) throw notFound();
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(showCategories)
      .where(and(eq(showCategories.id, categoryId), eq(showCategories.showId, showId)))
      .returning();
    if (!row) throw notFound();
    await writeAudit(tx, actor, { action: 'category.deleted', summary: `Removed the category ${row.name}`, entityType: 'category', entityId: categoryId, showId, supplierId: row.supplierId });
  });
}

/** Moves a category one place up or down in the storefront's order. */
export async function moveCategory(actor: UserActor, showId: string, categoryId: string, direction: 'up' | 'down') {
  await authorize(actor, 'categories.manage', { showId }, { write: true });
  if (!UUID.test(categoryId)) throw notFound();
  const db = await getDb();
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: showCategories.id, name: showCategories.name })
      .from(showCategories)
      .where(eq(showCategories.showId, showId))
      .orderBy(asc(showCategories.sort), asc(sql`lower(${showCategories.name})`))
      .for('update');
    const i = rows.findIndex((r) => r.id === categoryId);
    if (i < 0) throw notFound();
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    for (const [sort, r] of rows.entries()) await tx.update(showCategories).set({ sort }).where(eq(showCategories.id, r.id));
    await writeAudit(tx, actor, { action: 'category.moved', summary: `Moved the category ${rows[j].name} ${direction}`, entityType: 'category', entityId: categoryId, showId });
  });
}

/** The shows a supplier serves and its categories in each, for the supplier panel and Media10's page about them. */
export async function showsForSupplier(actor: Actor, supplierId: string, via: 'supplier.view' | 'suppliers.view') {
  await authorize(actor, via, via === 'supplier.view' ? { supplierId } : {});
  if (!UUID.test(supplierId)) throw notFound();
  const db = await getDb();
  const rows = await db
    .select({ showId: shows.id, showName: shows.name, slug: shows.slug, status: shows.status, closesAt: shows.orderingClosesAt, category: showCategories.name })
    .from(showCategories)
    .innerJoin(shows, eq(shows.id, showCategories.showId))
    .where(and(eq(showCategories.supplierId, supplierId), ne(shows.status, 'archived')))
    .orderBy(asc(shows.name), asc(showCategories.sort));
  const byShow = new Map<string, { id: string; name: string; slug: string; status: string; closesAt: Date | null; categories: string[] }>();
  for (const r of rows) {
    const s = byShow.get(r.showId) ?? { id: r.showId, name: r.showName, slug: r.slug, status: r.status, closesAt: r.closesAt, categories: [] };
    s.categories.push(r.category);
    byShow.set(r.showId, s);
  }
  return [...byShow.values()];
}

/**
 * What an exhibitor sees on the storefront: categories whose supplier can sell. A paused supplier,
 * or one not yet connected to Stripe, is left out, so nothing can be ordered from them.
 */
export async function storefrontCategories(actor: Actor, showId: string) {
  await authorize(actor, 'storefront.browse', { showId });
  const db = await getDb();
  return db
    .select({ id: showCategories.id, name: showCategories.name, description: showCategories.description, supplierName: suppliers.name })
    .from(showCategories)
    .innerJoin(suppliers, eq(suppliers.id, showCategories.supplierId))
    .where(and(eq(showCategories.showId, showId), isNotNull(showCategories.supplierId), sellable))
    .orderBy(asc(showCategories.sort), asc(sql`lower(${showCategories.name})`));
}

/** Show ids a supplier serves, for reminder emails to those shows' admins. */
export async function showIdsServedBy(supplierIds: string[]) {
  if (!supplierIds.length) return new Map<string, string[]>();
  const db = await getDb();
  const rows = await db
    .selectDistinct({ supplierId: showCategories.supplierId, showId: showCategories.showId })
    .from(showCategories)
    .where(inArray(showCategories.supplierId, supplierIds));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.supplierId!, [...(out.get(r.supplierId!) ?? []), r.showId]);
  return out;
}
