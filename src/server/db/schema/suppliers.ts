import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { COMMISSION_TYPES, createdAt, id, tz, updatedAt } from './common';
import { files, users } from './core';

/**
 * `company`: an outside supplier, paid straight into its own connected Stripe account.
 * `organiser`: Media10 itself, for its own services (such as stand cleaning). Charged on Media10's
 * own Stripe account, so it never connects one. There is at most one.
 */
export const SUPPLIER_KINDS = ['company', 'organiser'] as const;
export type SupplierKind = (typeof SUPPLIER_KINDS)[number];

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
    kind: text('kind', { enum: SUPPLIER_KINDS }).notNull().default('company'),
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
    /** When Stripe last told us (webhook or "Check status"), so an older event never overwrites a newer one. */
    stripeCheckedAt: timestamp('stripe_checked_at', tz),
    /** Paused suppliers' services are hidden and they take no new orders. Paid orders are untouched. */
    /** This supplier's commission at every show, unless a category or product sets its own. Super admins only. */
    commissionType: text('commission_type', { enum: COMMISSION_TYPES }),
    commissionValue: integer('commission_value'),
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
    uniqueIndex('suppliers_one_organiser').on(t.kind).where(sql`${t.kind} = 'organiser'`),
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

export const DOCUMENT_KINDS = ['public_liability', 'employers_liability', 'product_liability', 'risk_assessment', 'method_statement', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * A supplier's documents, such as public liability insurance. Files are private: only Media10,
 * the supplier's own people and the teams of shows it supplies can open them. Reminders go 30 days
 * before the expiry date; `reminderSentFor` records which expiry date was reminded about, so a
 * renewed document gets its own reminder.
 */
export const supplierDocuments = pgTable(
  'supplier_documents',
  {
    id: id(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: DOCUMENT_KINDS }).notNull(),
    title: text('title').notNull(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    /** The last day it is valid (a calendar date, no time). */
    expiresOn: date('expires_on'),
    reminderSentFor: date('reminder_sent_for'),
    uploadedBy: uuid('uploaded_by'),
    createdAt: createdAt(),
  },
  (t) => [index('supplier_documents_supplier_idx').on(t.supplierId), index('supplier_documents_expiry_idx').on(t.expiresOn)],
);
