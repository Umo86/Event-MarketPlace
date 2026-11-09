import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './common';
import { users } from './core';

/**
 * A supplier: a company exhibitors buy stand services from. Suppliers work across shows, so they
 * belong to the platform, not to one show. The supplier is the seller (DECISIONS.md, decision 1).
 *
 * Status shown to people is worked out, not stored (src/lib/supplier-status.ts): Paused when paused;
 * Ready to sell once Stripe says it can take payments; Invited until someone has signed in; otherwise
 * Stripe pending.
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    name: text('name').notNull(),
    /** The supplier's main contact, for Media10's records. Sign-in accounts are in supplier_users. */
    contactName: text('contact_name').notNull().default(''),
    email: text('email').notNull(),
    phone: text('phone'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    postcode: text('postcode'),
    country: text('country').notNull().default('United Kingdom'),
    vatRegistered: boolean('vat_registered').notNull().default(true),
    vatNumber: text('vat_number'),
    /** Letters put in front of the supplier's invoice and credit note numbers, e.g. SPK. */
    invoicePrefix: text('invoice_prefix').notNull(),
    /** Stripe connected account id (acct_…) and what Stripe says about it. Never keys or bank details. */
    stripeAccountId: text('stripe_account_id'),
    stripeChargesEnabled: boolean('stripe_charges_enabled').notNull().default(false),
    stripePayoutsEnabled: boolean('stripe_payouts_enabled').notNull().default(false),
    stripeDetailsSubmitted: boolean('stripe_details_submitted').notNull().default(false),
    /** Paused suppliers' services are hidden and they take no new orders. Paid orders are untouched. */
    pausedAt: timestamp('paused_at', tz),
    pausedReason: text('paused_reason'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('suppliers_stripe_unique').on(t.stripeAccountId),
    uniqueIndex('suppliers_invoice_prefix_unique').on(sql`upper(${t.invoicePrefix})`),
    index('suppliers_name_idx').on(sql`lower(${t.name})`),
  ],
);

export const SUPPLIER_ROLES = ['owner', 'staff'] as const;
export type SupplierRole = (typeof SUPPLIER_ROLES)[number];

/** People who sign in for a supplier. The owner decides what staff may do. */
export const supplierUsers = pgTable(
  'supplier_users',
  {
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: SUPPLIER_ROLES }).notNull().default('staff'),
    canRefund: boolean('can_refund').notNull().default(false),
    canEditCatalogue: boolean('can_edit_catalogue').notNull().default(false),
    addedBy: uuid('added_by'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.userId] }), index('supplier_users_user_idx').on(t.userId)],
);
