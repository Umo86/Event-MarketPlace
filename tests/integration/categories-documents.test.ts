import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { auditLog, emailOutbox, supplierDocuments, suppliers } from '@/server/db/schema';
import { assignableSuppliers, createCategory, deleteCategory, listCategories, moveCategory, showsForSupplier, storefrontCategories, updateCategory } from '@/server/services/categories';
import { addDocument, documentFileFor, documentWarnings, listDocuments, removeDocument, sendDocumentReminders } from '@/server/services/documents';
import { createOrganiserSupplier } from '@/server/services/suppliers';
import { authorize } from '@/server/authz';
import { setStorageForTests, MemoryStorage } from '@/server/storage';
import { documentState, expiryPhrase } from '@/lib/documents';
import { addStaff, exhibitorActor, makeShow, makeSupplier, makeUser, actorFor } from '../support/factories';

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
  setStorageForTests(new MemoryStorage());
});

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const pdf = (name = 'insurance.pdf') => ({ bytes: PDF, name });

/** A date `days` from today, as YYYY-MM-DD (UK date, close enough for these tests at any hour). */
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function ready(supplierId: string) {
  const db = await getDb();
  await db.update(suppliers).set({ stripeAccountId: `acct_test${supplierId.slice(0, 8)}`, stripeChargesEnabled: true }).where(eq(suppliers.id, supplierId));
}

describe('categories and their supplier', () => {
  it('give each category one supplier, changeable by show admins only', async () => {
    const show = await makeShow();
    const admin = await addStaff(show.id, 'show_admin');
    const team = await addStaff(show.id, 'show_team', ['orders']);
    const sparks = await makeSupplier();
    const other = await makeSupplier();
    const cat = await createCategory(admin, show.id, { name: 'Electrics', description: 'Power and lighting', supplierId: sparks.supplier.id });
    await expect(createCategory(admin, show.id, { name: 'electrics' })).rejects.toMatchObject({ fieldErrors: { name: expect.any(String) } });
    await expect(createCategory(team, show.id, { name: 'Carpet' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(assignableSuppliers(team, show.id)).rejects.toMatchObject({ code: 'forbidden' });
    // The team can see them.
    expect((await listCategories(team, show.id)).map((c) => [c.name, c.supplier?.name])).toEqual([['Electrics', sparks.supplier.name]]);
    // Choosing another supplier replaces the first: one per category.
    await updateCategory(admin, show.id, cat.id, { name: 'Electrics', description: 'Power and lighting', supplierId: other.supplier.id });
    expect((await listCategories(admin, show.id))[0].supplier?.id).toBe(other.supplier.id);
    const db = await getDb();
    const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, cat.id));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['category.created', 'category.supplier_changed']));
    // A show admin of another show can't touch it.
    const elsewhere = await addStaff((await makeShow()).id, 'show_admin');
    await expect(updateCategory(elsewhere, show.id, cat.id, { name: 'Taken over' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('show on the storefront only once their supplier is ready to sell', async () => {
    const show = await makeShow();
    const admin = await addStaff(show.id, 'show_admin');
    const sparks = await makeSupplier();
    const superAdmin = sparks.admin;
    const organiser = await createOrganiserSupplier(superAdmin, { name: 'Media10 Ltd', contactName: 'Ops', email: 'ops@media10.example.com', vatRegistered: true, invoicePrefix: 'MED' });
    await createCategory(admin, show.id, { name: 'Electrics', supplierId: sparks.supplier.id });
    await createCategory(admin, show.id, { name: 'Stand cleaning', supplierId: organiser.id });
    await createCategory(admin, show.id, { name: 'Furniture' });
    const exhibitor = exhibitorActor(show.id, 'sam@example.com');
    expect((await storefrontCategories(exhibitor, show.id)).map((c) => c.name)).toEqual(['Stand cleaning']);
    await ready(sparks.supplier.id);
    expect((await storefrontCategories(exhibitor, show.id)).map((c) => c.name)).toEqual(['Electrics', 'Stand cleaning']);
    // Paused: hidden again.
    const db = await getDb();
    await db.update(suppliers).set({ pausedAt: new Date(), pausedReason: 'Insurance' }).where(eq(suppliers.id, sparks.supplier.id));
    expect((await storefrontCategories(exhibitor, show.id)).map((c) => c.name)).toEqual(['Stand cleaning']);
    // Another show's exhibitor sees nothing here.
    await expect(storefrontCategories(exhibitorActor((await makeShow()).id, 'sam@example.com'), show.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('can be reordered and removed, and the supplier sees which shows it serves', async () => {
    const show = await makeShow({ name: 'UKCW London 2027' });
    const admin = await addStaff(show.id, 'show_admin');
    const s = await makeSupplier();
    const a = await createCategory(admin, show.id, { name: 'Electrics', supplierId: s.supplier.id });
    const b = await createCategory(admin, show.id, { name: 'Lighting rigs', supplierId: s.supplier.id });
    await moveCategory(admin, show.id, b.id, 'up');
    expect((await listCategories(admin, show.id)).map((c) => c.name)).toEqual(['Lighting rigs', 'Electrics']);
    expect(await showsForSupplier(s.owner, s.supplier.id, 'supplier.view')).toEqual([expect.objectContaining({ name: 'UKCW London 2027', categories: ['Lighting rigs', 'Electrics'] })]);
    await deleteCategory(admin, show.id, a.id);
    expect((await listCategories(admin, show.id)).map((c) => c.name)).toEqual(['Lighting rigs']);
    await expect(showsForSupplier(admin, s.supplier.id, 'supplier.view')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('supplier documents', () => {
  it('works out whether a document is in date', () => {
    expect(documentState('2027-03-31', '2027-01-01')).toBe('valid');
    expect(documentState('2027-01-31', '2027-01-01')).toBe('expiring');
    expect(documentState('2026-12-31', '2027-01-01')).toBe('expired');
    expect(documentState(null, '2027-01-01')).toBe('no_expiry');
    expect(expiryPhrase('2027-01-01', '2027-01-01')).toBe('Expires today');
    expect(expiryPhrase('2027-01-13', '2027-01-01')).toBe('Expires in 12 days');
    expect(expiryPhrase('2026-12-29', '2027-01-01')).toBe('Expired 3 days ago');
  });

  it('are added by the owner or Media10, read by the team and the shows they supply, and private to everyone else', async () => {
    const show = await makeShow();
    const showAdmin = await addStaff(show.id, 'show_admin');
    const s = await makeSupplier();
    const doc = await addDocument(s.owner, s.supplier.id, { kind: 'public_liability', expiresOn: inDays(200) }, pdf());
    await expect(addDocument(s.owner, s.supplier.id, { kind: 'public_liability' }, pdf())).rejects.toMatchObject({ issues: expect.any(Array) });
    await expect(addDocument(s.owner, s.supplier.id, { kind: 'risk_assessment' }, { bytes: new TextEncoder().encode('<html>'), name: 'x.pdf' })).rejects.toThrow(/PDF, PNG or JPEG/);
    await addDocument(s.admin, s.supplier.id, { kind: 'risk_assessment' }, pdf('ra.pdf'));

    // A show admin can't see them until the supplier serves their show; then they can read, not change.
    expect(await documentFileFor(showAdmin, doc.fileId)).toBeNull();
    await expect(listDocuments(showAdmin, s.supplier.id)).rejects.toMatchObject({ code: 'not_found' });
    await createCategory(showAdmin, show.id, { name: 'Electrics', supplierId: s.supplier.id });
    expect(await documentFileFor(showAdmin, doc.fileId)).toMatchObject({ supplierId: s.supplier.id });
    expect((await listDocuments(showAdmin, s.supplier.id)).map((d) => d.title)).toEqual(['Public liability insurance', 'Risk assessment']);
    await expect(removeDocument(showAdmin, s.supplier.id, doc.id)).rejects.toMatchObject({ code: 'forbidden' });

    // Strangers, other suppliers and exhibitors get nothing.
    expect(await documentFileFor(actorFor(await makeUser()), doc.fileId)).toBeNull();
    expect(await documentFileFor((await makeSupplier()).owner, doc.fileId)).toBeNull();
    expect(await documentFileFor(exhibitorActor(show.id, 'sam@example.com'), doc.fileId)).toBeNull();
    expect(await documentFileFor(null, doc.fileId)).toBeNull();
    await expect(authorize(s.owner, 'supplier.documents.manage', { supplierId: s.supplier.id })).resolves.toBeTruthy();

    await removeDocument(s.owner, s.supplier.id, doc.id);
    expect((await listDocuments(s.owner, s.supplier.id)).map((d) => d.kind)).toEqual(['risk_assessment']);
  });

  it('warn 30 days before expiry, and remind the supplier and show admins once', async () => {
    const show = await makeShow({ name: 'Futurebuild 2027' });
    const showAdmin = await addStaff(show.id, 'show_admin');
    const team = await addStaff(show.id, 'show_team', ['orders']);
    const s = await makeSupplier();
    await createCategory(showAdmin, show.id, { name: 'Electrics', supplierId: s.supplier.id });
    const soon = await addDocument(s.owner, s.supplier.id, { kind: 'public_liability', expiresOn: inDays(20) }, pdf());
    await addDocument(s.owner, s.supplier.id, { kind: 'employers_liability', expiresOn: inDays(90) }, pdf('el.pdf'));
    const docs = await listDocuments(s.owner, s.supplier.id);
    expect(documentWarnings(docs).map((d) => d.id)).toEqual([soon.id]);

    const first = await sendDocumentReminders();
    expect(first.reminded).toBe(1);
    const db = await getDb();
    const toOwner = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, s.owner.email));
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0].subject).toMatch(/Public liability insurance expires in (19|20|21) days/);
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, showAdmin.email))).toHaveLength(1);
    // Team members aren't emailed; show admins are.
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, team.email))).toHaveLength(0);

    // Running again sends nothing more.
    expect((await sendDocumentReminders()).reminded).toBe(0);
    // A renewed document replaces the old one: no reminder about the old one, no warning.
    await db.update(supplierDocuments).set({ reminderSentFor: null }).where(eq(supplierDocuments.id, soon.id));
    await addDocument(s.owner, s.supplier.id, { kind: 'public_liability', expiresOn: inDays(380) }, pdf('new.pdf'));
    expect((await sendDocumentReminders()).reminded).toBe(0);
    expect(documentWarnings(await listDocuments(s.owner, s.supplier.id))).toHaveLength(0);
  });
});
