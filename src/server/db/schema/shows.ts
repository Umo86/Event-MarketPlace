import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './common';
import { users } from './core';
import type { ShowBranding } from '../../../lib/branding';

export const SHOW_STATUSES = ['draft', 'live', 'closed', 'archived'] as const;
export type ShowStatus = (typeof SHOW_STATUSES)[number];

/**
 * A show is one dated event exhibitors order for, such as "UK Construction Week London 2027",
 * with its storefront at /<slug>. See DECISIONS.md, "One table for shows".
 */
export const shows = pgTable(
  'shows',
  {
    id: id(),
    name: text('name').notNull(),
    /** The storefront's web address: /<slug>. Lower case letters, numbers and hyphens. */
    slug: text('slug').notNull(),
    venue: text('venue'),
    status: text('status', { enum: SHOW_STATUSES }).notNull().default('draft'),
    timezone: text('timezone').notNull().default('Europe/London'),
    currency: text('currency').notNull().default('GBP'),
    vatRateBps: integer('vat_rate_bps').notNull().default(2000),
    /** Name, logos, colours, banner, favicon and email sender name. Validated before saving. */
    branding: jsonb('branding').$type<ShowBranding>().notNull().default({}),
    /** Ordering dates. Early-bird prices apply until earlyBirdEndsAt; late prices from latePricesFrom. */
    orderingOpensAt: timestamp('ordering_opens_at', tz),
    earlyBirdEndsAt: timestamp('early_bird_ends_at', tz),
    latePricesFrom: timestamp('late_prices_from', tz),
    orderingClosesAt: timestamp('ordering_closes_at', tz),
    helpEmail: text('help_email'),
    helpPhone: text('help_phone'),
    /** Optional link to the show's Billie chat. */
    billieUrl: text('billie_url'),
    /**
     * The show's key for BluePrint and Billie: it sends the exhibitor list and signs exhibitors in.
     * Only its id, its SHA-256 and an encrypted signing key are kept; the key is shown once.
     */
    connectionKeyId: text('connection_key_id'),
    connectionKeyHash: text('connection_key_hash'),
    connectionSigningKeyEnc: text('connection_signing_key_enc'),
    connectionKeyCreatedAt: timestamp('connection_key_created_at', tz),
    lastListSyncAt: timestamp('last_list_sync_at', tz),
    lastLinkSignInAt: timestamp('last_link_sign_in_at', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('shows_slug_unique').on(t.slug), uniqueIndex('shows_connection_key_unique').on(t.connectionKeyId)],
);

export const SHOW_ROLES = ['show_admin', 'show_team'] as const;
export type ShowRole = (typeof SHOW_ROLES)[number];

/**
 * Rights a show admin can give a team member. Show admins hold them all. Refunds are never
 * implied by "orders": they have to be given on their own.
 */
export const SHOW_PERMISSIONS = ['orders', 'exhibitors', 'reports', 'refunds'] as const;
export type ShowPermission = (typeof SHOW_PERMISSIONS)[number];

export const showStaff = pgTable(
  'show_staff',
  {
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: SHOW_ROLES }).notNull(),
    permissions: jsonb('permissions').$type<ShowPermission[]>().notNull().default([]),
    addedBy: uuid('added_by'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.showId, t.userId] }), index('show_staff_user_idx').on(t.userId)],
);

export const halls = pgTable(
  'halls',
  {
    id: id(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [uniqueIndex('halls_name_unique').on(t.showId, sql`lower(${t.name})`)],
);

/** Shell scheme, space only, or any other type a show uses. Decides which services an exhibitor sees. */
export const standTypes = pgTable(
  'stand_types',
  {
    id: id(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    /** Stable key made from the name: shell_scheme, space_only. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [uniqueIndex('stand_types_key_unique').on(t.showId, t.key)],
);

export const LIST_STATUSES = ['active', 'removed'] as const;
export const LIST_SOURCES = ['upload', 'blueprint', 'manual'] as const;

export const stands = pgTable(
  'stands',
  {
    id: id(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    hallId: uuid('hall_id').references(() => halls.id, { onDelete: 'set null' }),
    standTypeId: uuid('stand_type_id').references(() => standTypes.id, { onDelete: 'set null' }),
    companyName: text('company_name').notNull(),
    /** Removed stands are kept (never deleted) so past orders keep their stand. */
    status: text('status', { enum: LIST_STATUSES }).notNull().default('active'),
    source: text('source', { enum: LIST_SOURCES }).notNull().default('upload'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('stands_number_unique').on(t.showId, sql`lower(${t.number})`), index('stands_show_idx').on(t.showId)],
);

/**
 * One row per contact per stand: the show's exhibitor list. Exhibitors sign in to the storefront
 * by being on it. The same contact keeps the same row across re-uploads (matched by email + stand).
 */
export const exhibitorContacts = pgTable(
  'exhibitor_contacts',
  {
    id: id(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    standId: uuid('stand_id')
      .notNull()
      .references(() => stands.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name').notNull().default(''),
    phone: text('phone'),
    status: text('status', { enum: LIST_STATUSES }).notNull().default('active'),
    /** BluePrint's own id for the exhibitor, when the list came from BluePrint. */
    externalId: text('external_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('exhibitor_contacts_unique').on(t.showId, t.standId, t.email),
    index('exhibitor_contacts_email_idx').on(t.showId, t.email),
  ],
);

/**
 * A storefront sign-in. It belongs to one show and only ever unlocks exhibitor things there
 * (DECISIONS.md, "Exhibitor sign-ins are kept apart"). It lasts while the email stays on the list.
 */
export const exhibitorSessions = pgTable(
  'exhibitor_sessions',
  {
    /** SHA-256 (hex) of the token in the cookie. */
    id: text('id').primaryKey(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    method: text('method', { enum: ['code', 'link'] }).notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', tz).notNull(),
    lastSeenAt: timestamp('last_seen_at', tz).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    revokedAt: timestamp('revoked_at', tz),
  },
  (t) => [index('exhibitor_sessions_email_idx').on(t.showId, t.email)],
);

/** Sign-in links from BluePrint or Billie work once: each token's id is kept until it would have expired. */
export const usedSignInTokens = pgTable(
  'used_sign_in_tokens',
  {
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    jti: text('jti').notNull(),
    expiresAt: timestamp('expires_at', tz).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.showId, t.jti] })],
);
