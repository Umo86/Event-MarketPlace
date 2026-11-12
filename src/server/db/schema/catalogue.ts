import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { COMMISSION_TYPES, createdAt, id, tz, updatedAt } from './common';
import { shows } from './shows';
import { suppliers } from './suppliers';

/**
 * A show's categories, such as "Electrics" or "Stand cleaning". Each has at most one supplier, so
 * "one supplier per category per show" holds by construction. Media10's own services are a
 * category whose supplier is the organiser supplier.
 */
export const showCategories = pgTable(
  'show_categories',
  {
    id: id(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    sort: integer('sort').notNull().default(0),
    /** Restricted so a supplier with orders can't simply vanish; unassign first. */
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
    /** Commission for this category's products, unless a product sets its own. */
    commissionType: text('commission_type', { enum: COMMISSION_TYPES }),
    commissionValue: integer('commission_value'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('show_categories_name_unique').on(t.showId, sql`lower(${t.name})`), index('show_categories_supplier_idx').on(t.supplierId)],
);

export const PRODUCT_STATUSES = ['pending', 'live', 'rejected', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** The parts of a product exhibitors see that need a show admin's approval before they change. */
export type ProductChange = {
  name: string;
  description: string | null;
  imageFileId: string | null;
  pricePence: number;
  earlyPricePence: number | null;
  latePricePence: number | null;
  vatRateBps: number;
};

/**
 * A product a supplier sells at one show, in one of the categories it serves. Prices are net of
 * VAT, in whole pence.
 *
 * Price approval: a new product is `pending` until a show admin approves it. Once `live`, a change
 * to its name, description, image, prices or VAT rate is held in `pendingChange` while exhibitors
 * keep seeing the approved version. Placed orders copy what they need, so nothing here ever changes
 * an order.
 */
export const products = pgTable(
  'products',
  {
    id: id(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => showCategories.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** The supplier's own product code, if they use one. */
    code: text('code'),
    description: text('description'),
    imageFileId: uuid('image_file_id'),
    unit: text('unit').notNull().default('each'),
    pricePence: integer('price_pence').notNull(),
    /** Used while early-bird prices apply (the show's dates), when set. */
    earlyPricePence: integer('early_price_pence'),
    /** Used once late prices start (the show's dates), when set. */
    latePricePence: integer('late_price_pence'),
    vatRateBps: integer('vat_rate_bps').notNull().default(2000),
    /** How many can be sold in all; null means no limit. */
    stockLimit: integer('stock_limit'),
    /** Stand type keys that can see it; empty means every stand type. */
    standTypeKeys: jsonb('stand_type_keys').$type<string[]>().notNull().default([]),
    status: text('status', { enum: PRODUCT_STATUSES }).notNull().default('pending'),
    pendingChange: jsonb('pending_change').$type<ProductChange | null>(),
    submittedAt: timestamp('submitted_at', tz),
    rejectionReason: text('rejection_reason'),
    /** When it was first approved: an approved product taken off sale goes straight back on. */
    approvedAt: timestamp('approved_at', tz),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', tz),
    /** Set by show admins only; otherwise the category's, supplier's, show's or platform's. */
    commissionType: text('commission_type', { enum: COMMISSION_TYPES }),
    commissionValue: integer('commission_value'),
    sort: integer('sort').notNull().default(0),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('products_show_idx').on(t.showId, t.status), index('products_category_idx').on(t.categoryId), index('products_supplier_idx').on(t.supplierId)],
);
