import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './common';
import { files } from './core';
import { shows, stands } from './shows';
import { suppliers } from './suppliers';
import { products, showCategories } from './catalogue';

/**
 * Baskets, orders and money. All amounts are whole pence (CLAUDE.md, "Money").
 *
 * One order per checkout, for one stand. It splits into one supplier order per supplier, and each
 * supplier order is charged on its own: straight onto the supplier's Stripe account with Media10's
 * commission as the application fee, or on Media10's own account for Media10's own services. Each
 * supplier order has its own VAT invoice, in the seller's name, numbered in the seller's sequence.
 */

/** One exhibitor contact's basket for one stand. */
export const basketItems = pgTable(
  'basket_items',
  {
    id: id(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    standId: uuid('stand_id')
      .notNull()
      .references(() => stands.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('basket_items_unique').on(t.standId, t.email, t.productId), index('basket_items_owner_idx').on(t.showId, t.email)],
);

export const ORDER_STATUSES = ['pending_payment', 'paid', 'part_paid', 'payment_needed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const orders = pgTable(
  'orders',
  {
    id: id(),
    /** ORD-000001, one gap-free sequence across the platform. */
    number: text('number').notNull(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'restrict' }),
    standId: uuid('stand_id')
      .notNull()
      .references(() => stands.id, { onDelete: 'restrict' }),
    /** Who placed it, and the stand as it was then, so the order never changes if the list does. */
    email: text('email').notNull(),
    contactName: text('contact_name').notNull().default(''),
    companyName: text('company_name').notNull(),
    standNumber: text('stand_number').notNull(),
    hallName: text('hall_name'),
    standTypeName: text('stand_type_name'),
    poNumber: text('po_number'),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default('pending_payment'),
    netPence: integer('net_pence').notNull(),
    vatPence: integer('vat_pence').notNull(),
    totalPence: integer('total_pence').notNull(),
    /** Stock is held for this order until then, unless it's paid. */
    holdUntil: timestamp('hold_until', tz).notNull(),
    /** On Media10's own Stripe account: the customer, the SetupIntent and the saved card. */
    stripeCustomerId: text('stripe_customer_id'),
    stripeSetupIntentId: text('stripe_setup_intent_id'),
    stripePaymentMethodId: text('stripe_payment_method_id'),
    paidAt: timestamp('paid_at', tz),
    cancelledAt: timestamp('cancelled_at', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_number_unique').on(t.number),
    index('orders_show_idx').on(t.showId, t.createdAt),
    index('orders_stand_idx').on(t.standId),
    uniqueIndex('orders_setup_intent_unique').on(t.stripeSetupIntentId),
  ],
);

export const SUPPLIER_ORDER_STATUSES = ['pending', 'paid', 'payment_needed', 'cancelled', 'part_refunded', 'refunded'] as const;
export type SupplierOrderStatus = (typeof SUPPLIER_ORDER_STATUSES)[number];

/** One supplier's part of an order: one charge, one invoice. */
export const supplierOrders = pgTable(
  'supplier_orders',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    /** Media10's own services are charged on Media10's own account (null); others on the supplier's. */
    chargeAccount: text('charge_account'),
    status: text('status', { enum: SUPPLIER_ORDER_STATUSES }).notNull().default('pending'),
    netPence: integer('net_pence').notNull(),
    vatPence: integer('vat_pence').notNull(),
    totalPence: integer('total_pence').notNull(),
    /** Media10's commission: the application fee on the charge (0 for Media10's own services). */
    feePence: integer('fee_pence').notNull(),
    refundedPence: integer('refunded_pence').notNull().default(0),
    feeRefundedPence: integer('fee_refunded_pence').notNull().default(0),
    disputedPence: integer('disputed_pence').notNull().default(0),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeChargeId: text('stripe_charge_id'),
    /** Why the last try didn't work, in words the exhibitor can act on. */
    paymentError: text('payment_error'),
    attempts: integer('attempts').notNull().default(0),
    invoiceNumber: text('invoice_number'),
    invoiceFileId: uuid('invoice_file_id').references(() => files.id),
    paidAt: timestamp('paid_at', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('supplier_orders_unique').on(t.orderId, t.supplierId),
    index('supplier_orders_supplier_idx').on(t.supplierId, t.createdAt),
    index('supplier_orders_show_idx').on(t.showId),
    uniqueIndex('supplier_orders_pi_unique').on(t.stripePaymentIntentId),
    uniqueIndex('supplier_orders_invoice_unique').on(t.supplierId, t.invoiceNumber),
  ],
);

export const PRICE_BANDS = ['early', 'standard', 'late'] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

export const orderLines = pgTable(
  'order_lines',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    supplierOrderId: uuid('supplier_order_id')
      .notNull()
      .references(() => supplierOrders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => showCategories.id, { onDelete: 'set null' }),
    /** Copied when ordered. */
    description: text('description').notNull(),
    productCode: text('product_code'),
    unit: text('unit').notNull().default('each'),
    quantity: integer('quantity').notNull(),
    unitPricePence: integer('unit_price_pence').notNull(),
    priceBand: text('price_band', { enum: PRICE_BANDS }).notNull(),
    vatRateBps: integer('vat_rate_bps').notNull(),
    netPence: integer('net_pence').notNull(),
    vatPence: integer('vat_pence').notNull(),
    totalPence: integer('total_pence').notNull(),
    commissionPence: integer('commission_pence').notNull(),
    refundedPence: integer('refunded_pence').notNull().default(0),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [index('order_lines_supplier_order_idx').on(t.supplierOrderId), index('order_lines_product_idx').on(t.productId)],
);

export const REFUND_STATUSES = ['pending', 'succeeded', 'failed'] as const;

/**
 * Money given back on a supplier order, from our panels or from the supplier's own Stripe dashboard.
 * Each successful refund gets a credit note in the seller's sequence.
 */
export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    supplierOrderId: uuid('supplier_order_id')
      .notNull()
      .references(() => supplierOrders.id, { onDelete: 'cascade' }),
    amountPence: integer('amount_pence').notNull(),
    /** How the amount splits across the order's lines (line id → pence). */
    lineAmounts: jsonb('line_amounts').$type<Record<string, number>>().notNull().default({}),
    /** Media10's fee returned with it (Stripe works this out in proportion). */
    feeRefundedPence: integer('fee_refunded_pence').notNull().default(0),
    reason: text('reason').notNull(),
    status: text('status', { enum: REFUND_STATUSES }).notNull().default('pending'),
    source: text('source', { enum: ['panel', 'stripe'] }).notNull().default('panel'),
    stripeRefundId: text('stripe_refund_id'),
    error: text('error'),
    creditNoteNumber: text('credit_note_number'),
    creditNoteFileId: uuid('credit_note_file_id').references(() => files.id),
    requestedBy: uuid('requested_by'),
    /** True when a Media10 show admin refunded on the supplier's behalf (the supplier is emailed). */
    byMedia10: boolean('by_media10').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('refunds_supplier_order_idx').on(t.supplierOrderId), uniqueIndex('refunds_stripe_unique').on(t.stripeRefundId).where(sql`${t.stripeRefundId} is not null`)],
);

/** Card disputes (chargebacks) reported by Stripe on a supplier order. */
export const disputes = pgTable(
  'disputes',
  {
    id: id(),
    supplierOrderId: uuid('supplier_order_id')
      .notNull()
      .references(() => supplierOrders.id, { onDelete: 'cascade' }),
    stripeDisputeId: text('stripe_dispute_id').notNull(),
    amountPence: integer('amount_pence').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    evidenceDueBy: timestamp('evidence_due_by', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('disputes_stripe_unique').on(t.stripeDisputeId)],
);
