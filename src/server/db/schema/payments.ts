import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { tz } from './common';

/**
 * Every Stripe event we have applied, by its id, so a resent event is applied once only
 * (CLAUDE.md, "Stripe"). Kept small: the id, which endpoint, the type and the account.
 */
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  endpoint: text('endpoint', { enum: ['platform', 'connect'] }).notNull(),
  type: text('type').notNull(),
  account: text('account'),
  receivedAt: timestamp('received_at', tz).notNull().defaultNow(),
});
