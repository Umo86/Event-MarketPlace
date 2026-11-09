import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { useInMemoryDatabaseForTests } from '@/server/db/client';
import { auditLog, jobs, shows } from '@/server/db/schema';
import { writeAudit } from '@/server/audit';
import { enqueue, runDueJobs, claim, PermanentJobError } from '@/server/jobs/queue';
import { authorize } from '@/server/authz';
import { createShow, makeConnectionKey, setBrandingImage, updateBranding, updateShowSettings } from '@/server/services/shows';
import { AppError } from '@/server/errors';
import { addStaff, makeShow, makeSuperAdmin, makeUser, actorFor, exhibitorActor } from '../support/factories';

// A 1×1 transparent PNG.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});

describe('the audit log', () => {
  it('can be added to but never changed or deleted', async () => {
    const admin = await makeSuperAdmin();
    const { getDb } = await import('@/server/db/client');
    const db = await getDb();
    await writeAudit(db, admin, { action: 'test.thing', summary: 'Did a thing' });
    const refusal = (p: Promise<unknown>) => p.then(() => 'allowed', (err) => String((err as { cause?: Error }).cause?.message ?? (err as Error).message));
    expect(await refusal(db.update(auditLog).set({ summary: 'Did nothing' }).where(eq(auditLog.action, 'test.thing')))).toMatch(/append-only/);
    expect(await refusal(db.delete(auditLog).where(eq(auditLog.action, 'test.thing')))).toMatch(/append-only/);
    expect(await refusal(db.execute(sql`truncate audit_log`))).toMatch(/append-only/);
  });

  it('is written with the change, or not at all', async () => {
    const admin = await makeSuperAdmin();
    const { getDb } = await import('@/server/db/client');
    const db = await getDb();
    await expect(
      db.transaction(async (tx) => {
        await writeAudit(tx, admin, { action: 'test.rolled_back', summary: 'Should vanish' });
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'test.rolled_back'));
    expect(rows).toHaveLength(0);
  });
});

describe('the job queue', () => {
  it('queues a job once per key while it is waiting', async () => {
    const a = await enqueue('purge_expired', {}, { dedupeKey: 'test-dedupe' });
    const b = await enqueue('purge_expired', {}, { dedupeKey: 'test-dedupe' });
    expect(a).toBeTruthy();
    expect(b).toBeNull();
  });

  it('runs jobs, retries failures later and gives up on permanent ones', async () => {
    const { getDb } = await import('@/server/db/client');
    const db = await getDb();
    // Clear anything earlier tests left so this test only sees its own jobs.
    await runDueJobs({ purge_expired: async () => {}, send_email: async () => {} }, { budgetMs: 5000 });
    const ok = await enqueue('purge_expired', { n: 1 });
    const flaky = await enqueue('send_email', { outboxId: 'x' }, { maxAttempts: 3 });
    const doomed = await enqueue('send_email', { outboxId: 'gone' });
    const result = await runDueJobs(
      {
        purge_expired: async () => {},
        send_email: async (p) => {
          if (p.outboxId === 'gone') throw new PermanentJobError('That email no longer exists.');
          throw new Error('Resend is having a moment');
        },
      },
      { budgetMs: 5000 },
    );
    expect(result).toEqual({ done: 1, retried: 1, failed: 1 });
    const [okRow] = await db.select().from(jobs).where(eq(jobs.id, ok!));
    const [flakyRow] = await db.select().from(jobs).where(eq(jobs.id, flaky!));
    const [doomedRow] = await db.select().from(jobs).where(eq(jobs.id, doomed!));
    expect(okRow.status).toBe('done');
    expect(flakyRow.status).toBe('queued');
    expect(flakyRow.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(doomedRow.status).toBe('failed');
    expect(doomedRow.lastError).toMatch(/no longer exists/);
    // Not due yet, so nothing is claimed.
    expect(await claim(5)).toHaveLength(0);
  });
});

describe('shows', () => {
  it('are created by super admins with the usual stand types', async () => {
    const admin = await makeSuperAdmin();
    const show = await createShow(admin, { name: 'UK Construction Week London 2027' });
    expect(show.slug).toBe('uk-construction-week-london-2027');
    expect(show.status).toBe('draft');
    await expect(createShow(admin, { name: 'Another', slug: 'uk-construction-week-london-2027' })).rejects.toThrow(/already uses/);
    await expect(createShow(admin, { name: 'Sneaky', slug: 'admin' })).rejects.toThrow(/used by the marketplace/);
  });

  it('cannot be created by a show admin', async () => {
    const show = await makeShow();
    const showAdmin = await addStaff(show.id, 'show_admin');
    await expect(createShow(showAdmin, { name: 'Their own show' })).rejects.toBeInstanceOf(AppError);
  });

  it('are hidden from staff of other shows', async () => {
    const mine = await makeShow();
    const theirs = await makeShow();
    const admin = await addStaff(mine.id, 'show_admin');
    await expect(authorize(admin, 'show.view', { showId: theirs.id })).rejects.toMatchObject({ code: 'not_found' });
    await expect(authorize(admin, 'show.view', { showId: mine.id })).resolves.toBeTruthy();
  });

  it('keep ordering dates in order, in UK time', async () => {
    const show = await makeShow();
    const admin = await addStaff(show.id, 'show_admin');
    await expect(
      updateShowSettings(admin, { showId: show.id, name: show.name, status: 'live', orderingOpensAt: '2027-03-01 09:00', orderingClosesAt: '2027-02-01 17:00' }),
    ).rejects.toMatchObject({ fieldErrors: { orderingClosesAt: expect.stringMatching(/after/) } });
    await updateShowSettings(admin, { showId: show.id, name: show.name, status: 'live', orderingOpensAt: '2027-03-01 09:00', earlyBirdEndsAt: '2027-04-01 23:59', orderingClosesAt: '2027-05-10 17:00' });
    const { getDb } = await import('@/server/db/client');
    const [row] = await (await getDb()).select().from(shows).where(eq(shows.id, show.id));
    // 9am in March is 9am GMT; 5pm on 10 May is 4pm UTC (British Summer Time).
    expect(row.orderingOpensAt?.toISOString()).toBe('2027-03-01T09:00:00.000Z');
    expect(row.orderingClosesAt?.toISOString()).toBe('2027-05-10T16:00:00.000Z');
  });
});

describe('branding', () => {
  it('refuses a colour that fails contrast, with a suggestion, and saves one that passes', async () => {
    const show = await makeShow();
    const admin = await addStaff(show.id, 'show_admin');
    await expect(updateBranding(admin, { showId: show.id, marketplaceName: 'UKCW Marketplace', primaryColor: '#ffd400', accentColor: '', emailSenderName: '' })).rejects.toMatchObject({
      fieldErrors: { primaryColor: expect.stringMatching(/Try #[0-9a-f]{6}/) },
    });
    await updateBranding(admin, { showId: show.id, marketplaceName: 'UKCW Marketplace', primaryColor: '#B3122E', accentColor: '#f4d35e', emailSenderName: 'UKCW London Marketplace' });
    const { getDb } = await import('@/server/db/client');
    const db = await getDb();
    const [row] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(row.branding).toMatchObject({ marketplaceName: 'UKCW Marketplace', primaryColor: '#b3122e', accentColor: '#f4d35e', emailSenderName: 'UKCW London Marketplace' });
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.showId, show.id), eq(auditLog.action, 'show.branding_updated')));
    expect(audit).toHaveLength(1);
    expect(audit[0].actorUserId).toBe(admin.userId);
  });

  it('is for show admins only, not team members', async () => {
    const show = await makeShow();
    const member = await addStaff(show.id, 'show_team', ['orders', 'exhibitors', 'reports', 'refunds']);
    await expect(updateBranding(member, { showId: show.id, marketplaceName: 'x', primaryColor: '', accentColor: '', emailSenderName: '' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('accepts real images, cleans SVGs and gives each upload a new address', async () => {
    const show = await makeShow();
    const admin = await addStaff(show.id, 'show_admin');
    const first = await setBrandingImage(admin, show.id, 'logo', { bytes: PNG, name: 'logo.png' });
    const second = await setBrandingImage(admin, show.id, 'logo', { bytes: PNG, name: 'logo.png' });
    expect(first?.id).not.toBe(second?.id);
    expect(second?.mimeType).toBe('image/png');
    expect(second?.isPublic).toBe(true);

    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>x()</script><rect width="5" height="5"/></svg>');
    const cleaned = await setBrandingImage(admin, show.id, 'logoLight', { bytes: svg, name: 'logo.svg' });
    expect(cleaned?.mimeType).toBe('image/svg+xml');
    const { storage } = await import('@/server/storage');
    const body = await new Response(await storage().stream(cleaned!.storageKey)).text();
    expect(body).not.toMatch(/script|onload/);

    await expect(setBrandingImage(admin, show.id, 'favicon', { bytes: svg, name: 'fav.svg' })).rejects.toThrow(/Upload a PNG file/);
    await expect(setBrandingImage(admin, show.id, 'logo', { bytes: new TextEncoder().encode('hello'), name: 'logo.png' })).rejects.toThrow(/Upload a PNG, JPEG or SVG/);
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(PNG);
    await expect(setBrandingImage(admin, show.id, 'logo', { bytes: big, name: 'big.png' })).rejects.toThrow(/too big/);

    const { getDb } = await import('@/server/db/client');
    const [row] = await (await getDb()).select().from(shows).where(eq(shows.id, show.id));
    expect(row.branding.logoFileId).toBe(second?.id);
  });
});

describe('the BluePrint key', () => {
  it('is shown once and only its hash is kept', async () => {
    const show = await makeShow();
    const admin = await addStaff(show.id, 'show_admin');
    const key = await makeConnectionKey(admin, show.id);
    const { getDb } = await import('@/server/db/client');
    const [row] = await (await getDb()).select().from(shows).where(eq(shows.id, show.id));
    expect(key).toMatch(/^em_/);
    expect(row.connectionKeyHash).not.toContain(key);
    expect(row.connectionSigningKeyEnc).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain(key);
  });

  it('cannot be made by an exhibitor or someone outside the show', async () => {
    const show = await makeShow();
    const stranger = actorFor(await makeUser());
    await expect(makeConnectionKey(stranger, show.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(authorize(exhibitorActor(show.id, 'a@b.co'), 'show.connection.manage', { showId: show.id })).rejects.toMatchObject({ code: 'not_found' });
  });
});
