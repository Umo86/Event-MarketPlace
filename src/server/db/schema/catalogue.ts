import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './common';
import { shows } from './shows';
import { suppliers } from './suppliers';

/**
 * A show's categories, such as "Electrics" or "Stand cleaning". Each has at most one supplier, so
 * "one supplier per category per show" holds by construction. Media10's own services are a
 * category whose supplier is the organiser supplier. Products arrive in phase 2.
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('show_categories_name_unique').on(t.showId, sql`lower(${t.name})`), index('show_categories_supplier_idx').on(t.supplierId)],
);
