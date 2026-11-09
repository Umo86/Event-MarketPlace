import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './common';

// ---------------------------------------------------------------------------
// People who sign in with an account: Media10 staff and suppliers.
// Exhibitors have no account: they are rows on a show's exhibitor list (see shows.ts).
// ---------------------------------------------------------------------------

export const USER_STATUSES = ['invited', 'active', 'disabled'] as const;

export const users = pgTable(
  'users',
  {
    id: id(),
    /** Always stored lower-cased and trimmed. */
    email: text('email').notNull(),
    name: text('name').notNull().default(''),
    phone: text('phone'),
    isSuperAdmin: boolean('is_super_admin').notNull().default(false),
    status: text('status', { enum: USER_STATUSES }).notNull().default('active'),
    /** argon2id hash; null when the person only signs in with emailed codes. */
    passwordHash: text('password_hash'),
    /** TOTP secret, encrypted with AES-256-GCM (see server/security/crypto). */
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabledAt: timestamp('totp_enabled_at', tz),
    /** Last accepted TOTP time step, so a code cannot be used twice. */
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    /** SHA-256 hashes of unused recovery codes. */
    recoveryCodeHashes: jsonb('recovery_code_hashes').$type<string[]>().notNull().default([]),
    failedPasswordAttempts: integer('failed_password_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', tz),
    lastLoginAt: timestamp('last_login_at', tz),
    /** Set when someone else chose the password (a supplier's first login): it must be changed at the next sign-in. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 (hex) of the session token. The token itself only ever lives in the cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', tz).notNull(),
    lastSeenAt: timestamp('last_seen_at', tz).notNull().defaultNow(),
    idleTimeoutSeconds: integer('idle_timeout_seconds').notNull(),
    twoFactorVerified: boolean('two_factor_verified').notNull().default(false),
    ip: text('ip'),
    userAgent: text('user_agent'),
    revokedAt: timestamp('revoked_at', tz),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/**
 * Six-digit codes sent by email. `scope` keeps staff sign-in codes and each show's exhibitor
 * codes apart: a code sent for one can never be used for another.
 */
export const loginCodes = pgTable(
  'login_codes',
  {
    id: id(),
    email: text('email').notNull(),
    /** "staff" for account sign-in, or "show:<show id>" for an exhibitor signing in to a storefront. */
    scope: text('scope').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', tz).notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', tz),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('login_codes_email_idx').on(t.scope, t.email, t.createdAt)],
);

export const INVITATION_KINDS = ['super_admin', 'show_staff', 'supplier'] as const;
export type InvitationKind = (typeof INVITATION_KINDS)[number];

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    tokenHash: text('token_hash').notNull(),
    email: text('email').notNull(),
    kind: text('kind', { enum: INVITATION_KINDS }).notNull(),
    showId: uuid('show_id'),
    supplierId: uuid('supplier_id'),
    role: text('role'),
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', tz).notNull(),
    acceptedAt: timestamp('accepted_at', tz),
    acceptedUserId: uuid('accepted_user_id').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', tz),
    lastSentAt: timestamp('last_sent_at', tz),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invitations_token_unique').on(t.tokenHash),
    index('invitations_email_idx').on(t.email),
    index('invitations_show_idx').on(t.showId),
  ],
);

/** Fixed-window counters for rate limiting sign-in, codes, imports and other sensitive actions. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', tz).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const ACTOR_TYPES = ['user', 'exhibitor', 'system', 'api', 'anonymous'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/**
 * Append-only record of every change and every security event. A database trigger refuses
 * updates and deletes (migration 0001). Changes are written in the same transaction as the change.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    at: timestamp('at', tz).notNull().defaultNow(),
    actorType: text('actor_type', { enum: ACTOR_TYPES }).notNull(),
    actorUserId: uuid('actor_user_id'),
    actorEmail: text('actor_email'),
    /** What happened, as a dotted name: "show.branding_updated", "auth.sign_in". */
    action: text('action').notNull(),
    /** One plain sentence for people reading the log. */
    summary: text('summary').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    showId: uuid('show_id'),
    supplierId: uuid('supplier_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('audit_at_idx').on(t.at),
    index('audit_show_idx').on(t.showId, t.at),
    index('audit_supplier_idx').on(t.supplierId, t.at),
    index('audit_actor_idx').on(t.actorUserId, t.at),
    index('audit_entity_idx').on(t.entityType, t.entityId),
  ],
);

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid('updated_by'),
});

/** Atomic, gap-free counters for human-readable numbers (orders, invoices per supplier). */
export const counters = pgTable('counters', {
  key: text('key').primaryKey(),
  value: bigint('value', { mode: 'number' }).notNull().default(0),
});

// ---------------------------------------------------------------------------
// Background jobs (Postgres queue, from Billie)
// ---------------------------------------------------------------------------

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('queued'),
    runAt: timestamp('run_at', tz).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedUntil: timestamp('locked_until', tz),
    lastError: text('last_error'),
    /** Queued once while a job with the same key is waiting or running. */
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: timestamp('finished_at', tz),
  },
  (t) => [
    index('jobs_due_idx').on(t.status, t.runAt),
    uniqueIndex('jobs_dedupe_active_unique')
      .on(t.dedupeKey)
      .where(sql`dedupe_key is not null and status in ('queued', 'running')`),
    index('jobs_dedupe_idx').on(t.dedupeKey),
  ],
);

// ---------------------------------------------------------------------------
// Email and files
// ---------------------------------------------------------------------------

export const EMAIL_STATUSES = ['queued', 'sent', 'failed', 'suppressed'] as const;
export const EMAIL_CATEGORIES = ['transactional', 'reminder', 'security'] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/** Every email, recorded before it is handed to Resend (and shown in the local mailbox). */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: id(),
    showId: uuid('show_id'),
    toEmail: text('to_email').notNull(),
    templateKey: text('template_key').notNull(),
    category: text('category', { enum: EMAIL_CATEGORIES }).notNull(),
    fromAddress: text('from_address').notNull(),
    replyTo: text('reply_to'),
    subject: text('subject').notNull(),
    html: text('html').notNull(),
    text: text('text').notNull(),
    /** Files attached (invoices, credit notes), by file id. */
    attachmentFileIds: jsonb('attachment_file_ids').$type<string[]>().notNull().default([]),
    status: text('status', { enum: EMAIL_STATUSES }).notNull().default('queued'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    providerMessageId: text('provider_message_id'),
    sentAt: timestamp('sent_at', tz),
    createdAt: createdAt(),
  },
  (t) => [index('email_outbox_to_idx').on(t.toEmail, t.createdAt), index('email_outbox_status_idx').on(t.status)],
);

export const FILE_PURPOSES = ['branding', 'product', 'invoice', 'document'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export const files = pgTable(
  'files',
  {
    id: id(),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    purpose: text('purpose', { enum: FILE_PURPOSES }).notNull(),
    showId: uuid('show_id'),
    supplierId: uuid('supplier_id'),
    /** Public files (logos, banners, product photos) can be fetched without signing in, e.g. by email clients. */
    isPublic: boolean('is_public').notNull().default(false),
    uploadedBy: uuid('uploaded_by'),
    deletedAt: timestamp('deleted_at', tz),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('files_key_unique').on(t.storageKey), index('files_show_idx').on(t.showId)],
);
