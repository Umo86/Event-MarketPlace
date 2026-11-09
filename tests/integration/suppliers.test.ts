import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { auditLog, emailOutbox, sessions, supplierUsers, users } from '@/server/db/schema';
import { createSupplier, getSupplierForAdmin, listSuppliers, resetSupplierLogin, setSupplierPaused, temporaryPassword } from '@/server/services/suppliers';
import { setPassword, signInWithPassword } from '@/server/auth/login';
import { createSession } from '@/server/auth/sessions';
import { authorize } from '@/server/authz';
import { passwordProblems } from '@/server/security/password';
import { suggestPrefix } from '@/lib/supplier-status';
import { actorFor, addStaff, ctx, makeShow, makeSuperAdmin, makeUser } from '../support/factories';

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});

const details = (over: Partial<Parameters<typeof createSupplier>[1]> = {}) => ({
  name: 'Sparks Electrical Ltd',
  contactName: 'Pat Sparks',
  email: `pat-${Math.random().toString(36).slice(2, 8)}@sparks.co.uk`,
  vatRegistered: true,
  vatNumber: 'GB123456789',
  invoicePrefix: `S${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
  ...over,
});

describe('one-off passwords', () => {
  it('are easy to pass on and strong enough', () => {
    const p = temporaryPassword();
    expect(p).toMatch(/^[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}$/);
    expect(p).not.toMatch(/[01lIoO]/);
    expect(passwordProblems(p)).toBeNull();
    expect(temporaryPassword()).not.toBe(p);
  });

  it('come with a suggested invoice prefix', () => {
    expect(suggestPrefix('Sparks Electrical Ltd')).toBe('SE');
    expect(suggestPrefix('Carpetco')).toBe('CAR');
    expect(suggestPrefix('The Furniture & Hire Co')).toBe('FH');
  });
});

describe('adding a supplier', () => {
  it('makes the supplier and an owner login, sends no email, and keeps no readable password', async () => {
    const admin = await makeSuperAdmin();
    const input = details();
    const { supplier, login } = await createSupplier(admin, input);
    expect(login.password).toMatch(/-/);
    expect(login.signInUrl).toBe('http://localhost:3000/sign-in');
    const db = await getDb();
    const [u] = await db.select().from(users).where(eq(users.email, input.email));
    expect(u.mustChangePassword).toBe(true);
    expect(u.passwordHash).not.toContain(login.password);
    const [link] = await db.select().from(supplierUsers).where(eq(supplierUsers.userId, u.id));
    expect(link).toMatchObject({ supplierId: supplier.id, role: 'owner', canRefund: true });
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, input.email))).toHaveLength(0);
    const audit = await db.select().from(auditLog).where(eq(auditLog.supplierId, supplier.id));
    expect(audit[0].summary).toMatch(/Added the supplier Sparks Electrical Ltd/);
    expect(JSON.stringify(audit)).not.toContain(login.password!);
  });

  it('lets the supplier sign in with the one-off password, then makes them choose their own', async () => {
    const admin = await makeSuperAdmin();
    const input = details();
    const { supplier, login } = await createSupplier(admin, input);
    const listed = async () => (await listSuppliers(admin)).find((s) => s.id === supplier.id)?.status;
    expect(await listed()).toBe('invited');
    const user = await signInWithPassword(input.email, login.password!, ctx);
    const { session } = await createSession(user.id, ctx);
    expect(await listed()).toBe('stripe_pending');
    const actor = actorFor(user);
    await expect(setPassword(actor, login.password!, session)).rejects.toThrow(/not the one you have now/);
    await setPassword(actor, 'our own long sensible password', session);
    const db = await getDb();
    const [after] = await db.select().from(users).where(eq(users.id, user.id));
    expect(after.mustChangePassword).toBe(false);
    await expect(signInWithPassword(input.email, login.password!, ctx)).rejects.toThrow();
  });

  it('links an email that already has an account, without touching its password', async () => {
    const admin = await makeSuperAdmin();
    const existing = await makeUser({ email: 'both@media10.co.uk', passwordHash: 'kept' });
    const { login } = await createSupplier(admin, details({ email: 'Both@Media10.co.uk' }));
    expect(login).toMatchObject({ password: null, existingAccount: true });
    const db = await getDb();
    const [u] = await db.select().from(users).where(eq(users.id, existing.id));
    expect(u.passwordHash).toBe('kept');
    expect(u.mustChangePassword).toBe(false);
  });

  it('needs a unique invoice prefix', async () => {
    const admin = await makeSuperAdmin();
    await createSupplier(admin, details({ invoicePrefix: 'CPT' }));
    await expect(createSupplier(admin, details({ invoicePrefix: 'cpt' }))).rejects.toMatchObject({ fieldErrors: { invoicePrefix: expect.any(String) } });
  });

  it('is for super admins only', async () => {
    const show = await makeShow();
    const showAdmin = await addStaff(show.id, 'show_admin');
    await expect(createSupplier(showAdmin, details())).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('looking after a supplier’s logins', () => {
  it('makes a new one-off password that replaces the old one and signs them out', async () => {
    const admin = await makeSuperAdmin();
    const input = details();
    const { supplier, login } = await createSupplier(admin, input);
    const user = await signInWithPassword(input.email, login.password!, ctx);
    await createSession(user.id, ctx);
    const fresh = await resetSupplierLogin(admin, supplier.id, user.id);
    expect(fresh.password).not.toBe(login.password);
    await expect(signInWithPassword(input.email, login.password!, ctx)).rejects.toThrow();
    await expect(signInWithPassword(input.email, fresh.password!, ctx)).resolves.toMatchObject({ id: user.id });
    const db = await getDb();
    const open = (await db.select().from(sessions).where(eq(sessions.userId, user.id))).filter((s) => !s.revokedAt);
    expect(open).toHaveLength(0);
  });

  it('never resets a super admin’s password from here', async () => {
    const admin = await makeSuperAdmin();
    const other = await makeSuperAdmin();
    const { supplier } = await createSupplier(admin, details({ email: other.email }));
    await expect(resetSupplierLogin(admin, supplier.id, other.userId)).rejects.toThrow(/super admin/);
  });

  it('pauses with a reason, and takes off pause', async () => {
    const admin = await makeSuperAdmin();
    const { supplier } = await createSupplier(admin, details());
    await expect(setSupplierPaused(admin, supplier.id, { paused: true })).rejects.toThrow(/Say why/);
    await setSupplierPaused(admin, supplier.id, { paused: true, reason: 'Insurance certificate expired' });
    expect((await getSupplierForAdmin(admin, supplier.id)).supplier).toMatchObject({ status: 'paused', pausedReason: 'Insurance certificate expired' });
    await setSupplierPaused(admin, supplier.id, { paused: false });
    expect((await getSupplierForAdmin(admin, supplier.id)).supplier.status).toBe('invited');
  });
});

describe('the supplier panel', () => {
  it('opens only for the supplier’s own people, and owner actions only for the owner', async () => {
    const admin = await makeSuperAdmin();
    const a = await createSupplier(admin, details());
    const b = await createSupplier(admin, details());
    const db = await getDb();
    const [owner] = await db.select().from(users).where(eq(users.id, (await db.select().from(supplierUsers).where(eq(supplierUsers.supplierId, a.supplier.id)))[0].userId));
    const staffUser = await makeUser();
    await db.insert(supplierUsers).values({ supplierId: a.supplier.id, userId: staffUser.id, role: 'staff' });
    const ownerActor = actorFor(owner);
    await expect(authorize(ownerActor, 'supplier.view', { supplierId: a.supplier.id })).resolves.toMatchObject({ supplierRole: 'owner' });
    await expect(authorize(ownerActor, 'supplier.view', { supplierId: b.supplier.id })).rejects.toMatchObject({ code: 'not_found' });
    await expect(authorize(actorFor(staffUser), 'supplier.manage', { supplierId: a.supplier.id })).rejects.toMatchObject({ code: 'forbidden' });
    // Suppliers can't reach Media10's areas.
    await expect(authorize(ownerActor, 'suppliers.view')).rejects.toMatchObject({ code: 'not_found' });
  });
});
