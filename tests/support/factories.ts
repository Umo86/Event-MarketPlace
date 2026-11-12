import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { emailOutbox, showStaff, shows, standTypes, users, type ShowPermission, type ShowRole } from '@/server/db/schema';
import { applyList, type ListRow } from '@/server/services/exhibitors';
import type { ExhibitorActor, UserActor } from '@/server/auth/actor';

export async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const db = await getDb();
  const [u] = await db
    .insert(users)
    .values({ email: `user-${randomUUID().slice(0, 8)}@example.com`, name: 'Test User', status: 'active', ...overrides })
    .returning();
  return u;
}

export function actorFor(u: typeof users.$inferSelect, overrides: Partial<UserActor> = {}): UserActor {
  return { kind: 'user', userId: u.id, email: u.email, name: u.name, isSuperAdmin: u.isSuperAdmin, readOnly: false, ip: '127.0.0.1', userAgent: 'vitest', ...overrides };
}

export async function makeSuperAdmin() {
  return actorFor(await makeUser({ isSuperAdmin: true, name: 'Super Admin' }));
}

export async function makeShow(overrides: Partial<typeof shows.$inferInsert> = {}) {
  const db = await getDb();
  const slug = `show-${randomUUID().slice(0, 8)}`;
  const [show] = await db
    .insert(shows)
    .values({ name: 'Demo Show 2027', slug, status: 'live', ...overrides })
    .returning();
  await db.insert(standTypes).values([
    { showId: show.id, key: 'shell_scheme', name: 'Shell scheme', sort: 0 },
    { showId: show.id, key: 'space_only', name: 'Space only', sort: 1 },
  ]);
  return show;
}

export async function addStaff(showId: string, role: ShowRole, permissions: ShowPermission[] = []) {
  const db = await getDb();
  const u = await makeUser({ name: role === 'show_admin' ? 'Show Admin' : 'Team Member' });
  await db.insert(showStaff).values({ showId, userId: u.id, role, permissions });
  return actorFor(u);
}

export async function addExhibitors(showId: string, rows: Partial<ListRow>[]) {
  const db = await getDb();
  const full = rows.map((r, i) => ({ company: `Company ${i + 1}`, stand: `A${i + 1}`, hall: 'Hall 1', standType: 'Shell scheme', name: `Contact ${i + 1}`, email: `contact${i + 1}@example.com`, phone: '', ...r }));
  return db.transaction((tx) => applyList(tx, showId, full, { replace: false, source: 'upload' }));
}

export function exhibitorActor(showId: string, email: string): ExhibitorActor {
  return { kind: 'exhibitor', showId, email, ip: '127.0.0.1', userAgent: 'vitest' };
}

export async function lastEmailTo(email: string) {
  const db = await getDb();
  const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, email)).orderBy(desc(emailOutbox.createdAt)).limit(1);
  return row ?? null;
}

export const ctx = { ip: '127.0.0.1', userAgent: 'vitest' };

/** A supplier with its owner login (made the way a super admin makes one), and the owner as an actor. */
export async function makeSupplier(over: Record<string, unknown> = {}) {
  const { createSupplier } = await import('@/server/services/suppliers');
  const { supplierUsers } = await import('@/server/db/schema');
  const admin = await makeSuperAdmin();
  const tag = randomUUID().slice(0, 6);
  const { supplier } = await createSupplier(admin, {
    name: `Supplier ${tag}`,
    contactName: 'Pat Owner',
    email: `owner-${tag}@supplier.example.com`,
    vatRegistered: true,
    invoicePrefix: `S${tag.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase()}`,
    ...over,
  });
  const db = await getDb();
  const [link] = await db.select().from(supplierUsers).where(eq(supplierUsers.supplierId, supplier.id));
  const [u] = await db.select().from(users).where(eq(users.id, link.userId));
  return { supplier, owner: actorFor(u), admin };
}
