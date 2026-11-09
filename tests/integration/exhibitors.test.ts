import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { exhibitorContacts, exhibitorSessions, stands, standTypes } from '@/server/db/schema';
import { applyUpload, listExhibitors, previewUpload } from '@/server/services/exhibitors';
import { readSyncBody, showForKey, syncFromBlueprint } from '@/server/services/blueprint-sync';
import { makeConnectionKey } from '@/server/services/shows';
import { addStaff, ctx, makeShow } from '../support/factories';

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});

const csv = (lines: string[]) => ({ name: 'list.csv', bytes: new TextEncoder().encode(lines.join('\r\n')) });

const FIRST = [
  'Company name,Stand No,Hall,Stand type,Contact name,Email address,Phone',
  'Acme Displays Ltd,B12,Hall 1,Shell scheme,Sam Patel,Sam@Acme.co.uk,020 7946 0000',
  'Acme Displays Ltd,B12,Hall 1,Shell scheme,Ops Desk,ops@acme.co.uk,',
  'Brick & Co,C4,Hall 2,Space only,Jo Brick,jo@brick.co.uk,07700 900000',
  'Acme Displays Ltd,D1,Hall 2,Corner pavilion,Sam Patel,sam@acme.co.uk,',
  'No Email Ltd,E9,Hall 3,Shell scheme,Someone,,',
];

describe('uploading the exhibitor list', () => {
  it('finds columns by heading and shows what would change before changing anything', async () => {
    const show = await makeShow();
    const admin = await addStaff(show.id, 'show_admin');
    const { rows, plan } = await previewUpload(admin, show.id, csv(FIRST), { replace: false });
    expect(rows).toHaveLength(5);
    expect(rows[0].email).toBe('sam@acme.co.uk');
    expect(plan.counts).toEqual({ add: 4, update: 0, same: 0, remove: 0, skip: 1 });
    expect(plan.entries.find((e) => e.action === 'skip')?.problems[0]).toMatch(/email/);
    expect(plan.newHalls.sort()).toEqual(['Hall 1', 'Hall 2']);
    expect(plan.newStandTypes).toEqual(['Corner pavilion']);
    // Nothing has changed yet.
    expect(await listExhibitors(admin, show.id)).toHaveLength(0);
  });

  it('keeps the same record for the same email and stand across uploads', async () => {
    const show = await makeShow();
    const admin = await addStaff(show.id, 'show_admin');
    const first = await previewUpload(admin, show.id, csv(FIRST), { replace: false });
    await applyUpload(admin, { showId: show.id, replace: false, fileName: 'list.csv', rows: first.rows });
    const before = await listExhibitors(admin, show.id);
    expect(before).toHaveLength(4);
    expect(before.map((r) => r.standType)).toContain('Corner pavilion');

    const changed = [...FIRST.slice(0, 1), 'Acme Displays Ltd,B12,Hall 1,Shell scheme,Samir Patel,sam@acme.co.uk,', ...FIRST.slice(2)];
    const second = await previewUpload(admin, show.id, csv(changed), { replace: false });
    expect(second.plan.counts).toMatchObject({ add: 0, update: 1, same: 3 });
    expect(second.plan.entries.find((e) => e.action === 'update')?.changes[0]).toMatch(/Sam Patel → Samir Patel/);
    await applyUpload(admin, { showId: show.id, replace: false, fileName: 'list.csv', rows: second.rows });
    const after = await listExhibitors(admin, show.id);
    expect(after.map((r) => r.contactId).sort()).toEqual(before.map((r) => r.contactId).sort());
    expect(after.find((r) => r.stand === 'B12' && r.email === 'sam@acme.co.uk')?.name).toBe('Samir Patel');
  });

  it('can replace the list, removing (not deleting) anyone left out and ending their sign-ins', async () => {
    const show = await makeShow();
    const admin = await addStaff(show.id, 'show_admin');
    const first = await previewUpload(admin, show.id, csv(FIRST), { replace: false });
    await applyUpload(admin, { showId: show.id, replace: false, fileName: 'list.csv', rows: first.rows });
    const db = await getDb();
    await db.insert(exhibitorSessions).values({ id: 'session-for-jo', showId: show.id, email: 'jo@brick.co.uk', method: 'code', expiresAt: new Date(Date.now() + 86_400_000) });

    const smaller = await previewUpload(admin, show.id, csv(FIRST.slice(0, 3)), { replace: true });
    expect(smaller.plan.counts).toMatchObject({ same: 2, remove: 2 });
    await applyUpload(admin, { showId: show.id, replace: true, fileName: 'smaller.csv', rows: smaller.rows });

    expect((await listExhibitors(admin, show.id)).map((r) => r.email).sort()).toEqual(['ops@acme.co.uk', 'sam@acme.co.uk']);
    const all = await listExhibitors(admin, show.id, { includeRemoved: true });
    expect(all.find((r) => r.email === 'jo@brick.co.uk')?.contactStatus).toBe('removed');
    const [c4] = await db.select().from(stands).where(and(eq(stands.showId, show.id), eq(stands.number, 'C4')));
    expect(c4.status).toBe('removed');
    const [session] = await db.select().from(exhibitorSessions).where(eq(exhibitorSessions.id, 'session-for-jo'));
    expect(session.revokedAt).not.toBeNull();
  });

  it('explains missing columns', async () => {
    const show = await makeShow();
    const admin = await addStaff(show.id, 'show_admin');
    await expect(previewUpload(admin, show.id, csv(['Firm,Place', 'Acme,B12']), { replace: false })).rejects.toThrow(/couldn’t find these columns: Company, Stand, Email/);
  });

  it('is for people with the exhibitors right only', async () => {
    const show = await makeShow();
    const ordersOnly = await addStaff(show.id, 'show_team', ['orders']);
    await expect(previewUpload(ordersOnly, show.id, csv(FIRST), { replace: false })).rejects.toMatchObject({ code: 'forbidden' });
    const exhibitorsRight = await addStaff(show.id, 'show_team', ['exhibitors']);
    await expect(previewUpload(exhibitorsRight, show.id, csv(FIRST), { replace: false })).resolves.toBeTruthy();
  });
});

describe('the list sent by BluePrint', () => {
  const body = {
    exhibitors: [
      { id: 'ex_1', company: 'Acme Displays Ltd', stand: 'B12', hall: 'Hall 1', standType: 'Shell scheme', contacts: [{ name: 'Sam', email: 'sam@acme.co.uk' }, { email: 'not-an-email' }] },
      { id: 2, company: 'Brick & Co', stand: 'C4', contacts: [{ email: 'jo@brick.co.uk', phone: 7700900000 }] },
      { id: 'ex_3', company: 'Ghost Ltd', stand: 'Z1', contacts: [] },
    ],
  };

  it('is checked like a spreadsheet', () => {
    const r = readSyncBody(body);
    expect(r).toMatchObject({ ok: true, skipped: 1 });
    if (r.ok) expect(r.rows.map((x) => x.email)).toEqual(['sam@acme.co.uk', 'jo@brick.co.uk']);
    expect(readSyncBody({})).toMatchObject({ ok: false });
    expect(readSyncBody({ exhibitors: [{ company: 'A', contacts: [] }] })).toMatchObject({ ok: false, error: expect.stringMatching(/exhibitors\.0\.stand/) });
    expect(readSyncBody({ exhibitors: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/empty list/) });
  });

  it('only works with the show’s current key', async () => {
    const show = await makeShow();
    const other = await makeShow();
    const admin = await addStaff(show.id, 'show_admin');
    const otherAdmin = await addStaff(other.id, 'show_admin');
    const key = await makeConnectionKey(admin, show.id);
    const otherKey = await makeConnectionKey(otherAdmin, other.id);
    expect((await showForKey(show.slug, key))?.id).toBe(show.id);
    expect(await showForKey(show.slug, otherKey)).toBeNull();
    expect(await showForKey(show.slug, null)).toBeNull();
    // A new key replaces the old one at once.
    await makeConnectionKey(admin, show.id);
    expect(await showForKey(show.slug, key)).toBeNull();
  });

  it('replaces the list, keeping BluePrint’s ids', async () => {
    const show = await makeShow();
    const admin = await addStaff(show.id, 'show_admin');
    const r = readSyncBody(body);
    if (!r.ok) throw new Error(r.error);
    expect(await syncFromBlueprint(show, r.rows, ctx)).toMatchObject({ added: 2, removed: 0 });
    const db = await getDb();
    const [sam] = await db.select().from(exhibitorContacts).where(and(eq(exhibitorContacts.showId, show.id), eq(exhibitorContacts.email, 'sam@acme.co.uk')));
    expect(sam.externalId).toBe('ex_1');

    const again = readSyncBody({ exhibitors: [body.exhibitors[0]] });
    if (!again.ok) throw new Error(again.error);
    expect(await syncFromBlueprint(show, again.rows, ctx)).toMatchObject({ added: 0, removed: 1 });
    const live = await listExhibitors(admin, show.id);
    expect(live.map((x) => x.email)).toEqual(['sam@acme.co.uk']);
    const [sam2] = await db.select().from(exhibitorContacts).where(eq(exhibitorContacts.id, sam.id));
    expect(sam2.status).toBe('active');
    const types = await db.select().from(standTypes).where(eq(standTypes.showId, show.id));
    expect(types.map((t) => t.key).sort()).toEqual(['shell_scheme', 'space_only']);
  });
});
