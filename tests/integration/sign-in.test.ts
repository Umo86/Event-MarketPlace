import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { emailOutbox, exhibitorContacts, showStaff, users } from '@/server/db/schema';
import { requestExhibitorCode, signInWithLink, validateExhibitorSession, verifyExhibitorCode, myStands } from '@/server/services/storefront-auth';
import { getShow, makeConnectionKey } from '@/server/services/shows';
import { signToken } from '@/server/security/connection-key';
import { requestSignInCode, verifySignInCode } from '@/server/auth/login';
import { acceptInvitation, createInvitation, findInvitation, sendInvitationCode } from '@/server/auth/invitations';
import { authorize } from '@/server/authz';
import { addExhibitors, addStaff, ctx, lastEmailTo, makeShow, makeUser } from '../support/factories';

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});

const codeIn = (text: string | undefined) => /\b(\d{6})\b/.exec(text ?? '')?.[1] ?? '';

async function emailsTo(email: string) {
  const db = await getDb();
  return db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, email));
}

describe('exhibitors signing in with an emailed code', () => {
  it('sends a branded code only to emails on the show’s list, and says the same either way', async () => {
    const show = await makeShow({ branding: { marketplaceName: 'UKCW London Marketplace', emailSenderName: 'UKCW London Marketplace' } });
    await addExhibitors(show.id, [{ email: 'sam@acme.co.uk' }]);
    await expect(requestExhibitorCode(show, 'Sam@Acme.co.uk', ctx)).resolves.toBeUndefined();
    await expect(requestExhibitorCode(show, 'stranger@nowhere.com', ctx)).resolves.toBeUndefined();
    const mail = await lastEmailTo('sam@acme.co.uk');
    expect(mail?.subject).toMatch(/^\d{6} is your UKCW London Marketplace sign-in code$/);
    expect(mail?.fromAddress).toBe('"UKCW London Marketplace" <marketplace@mail.example.com>');
    expect(await emailsTo('stranger@nowhere.com')).toHaveLength(0);
  });

  it('signs in with the right code once, and binds the sign-in to that show', async () => {
    const show = await makeShow();
    const other = await makeShow();
    await addExhibitors(show.id, [{ email: 'jo@brick.co.uk', stand: 'C4' }, { email: 'jo@brick.co.uk', stand: 'C5', company: 'Brick & Co' }]);
    await requestExhibitorCode(show, 'jo@brick.co.uk', ctx);
    const code = codeIn((await lastEmailTo('jo@brick.co.uk'))?.text);
    const { token } = await verifyExhibitorCode(show, 'jo@brick.co.uk', code, ctx);
    await expect(verifyExhibitorCode(show, 'jo@brick.co.uk', code, ctx)).rejects.toThrow(/wrong or has expired/);

    const actor = await validateExhibitorSession(token, show.id);
    expect(actor).toMatchObject({ kind: 'exhibitor', showId: show.id, email: 'jo@brick.co.uk' });
    expect((await myStands(actor!)).map((s) => s.number)).toEqual(['C4', 'C5']);
    // The same cookie is worthless at another show, and can't open the admin area.
    expect(await validateExhibitorSession(token, other.id)).toBeNull();
    await expect(authorize(actor, 'storefront.browse', { showId: other.id })).rejects.toMatchObject({ code: 'not_found' });
    await expect(authorize(actor, 'show.view', { showId: show.id })).rejects.toMatchObject({ code: 'not_found' });
    await expect(authorize(actor, 'shows.list')).rejects.toBeTruthy();
  });

  it('allows five tries per code', async () => {
    const show = await makeShow();
    await addExhibitors(show.id, [{ email: 'guess@acme.co.uk' }]);
    await requestExhibitorCode(show, 'guess@acme.co.uk', ctx);
    const code = codeIn((await lastEmailTo('guess@acme.co.uk'))?.text);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await expect(verifyExhibitorCode(show, 'guess@acme.co.uk', wrong, ctx)).rejects.toThrow();
    await expect(verifyExhibitorCode(show, 'guess@acme.co.uk', code, ctx)).rejects.toThrow(/wrong or has expired/);
  });

  it('ends a sign-in when the email comes off the list', async () => {
    const show = await makeShow();
    await addExhibitors(show.id, [{ email: 'leaving@acme.co.uk' }]);
    await requestExhibitorCode(show, 'leaving@acme.co.uk', ctx);
    const { token } = await verifyExhibitorCode(show, 'leaving@acme.co.uk', codeIn((await lastEmailTo('leaving@acme.co.uk'))?.text), ctx);
    const db = await getDb();
    await db.update(exhibitorContacts).set({ status: 'removed' }).where(and(eq(exhibitorContacts.showId, show.id), eq(exhibitorContacts.email, 'leaving@acme.co.uk')));
    expect(await validateExhibitorSession(token, show.id)).toBeNull();
  });

  it('never opens a draft show', async () => {
    const show = await makeShow({ status: 'draft' });
    await addExhibitors(show.id, [{ email: 'early@acme.co.uk' }]);
    await requestExhibitorCode(show, 'early@acme.co.uk', ctx);
    expect(await emailsTo('early@acme.co.uk')).toHaveLength(0);
  });
});

describe('exhibitors signing in from BluePrint or Billie', () => {
  it('works once per link, for emails on this show’s list only', async () => {
    const made = await makeShow();
    const other = await makeShow();
    const admin = await addStaff(made.id, 'show_admin');
    const otherAdmin = await addStaff(other.id, 'show_admin');
    const key = await makeConnectionKey(admin, made.id);
    const otherKey = await makeConnectionKey(otherAdmin, other.id);
    await addExhibitors(made.id, [{ email: 'sam@acme.co.uk' }]);
    const show = (await getShow(made.id))!;

    const link = signToken(key, 'sam@acme.co.uk');
    const first = await signInWithLink(show, link, ctx);
    expect(first).toMatchObject({ ok: true });
    if (first.ok) expect(await validateExhibitorSession(first.token, show.id)).toMatchObject({ email: 'sam@acme.co.uk' });
    expect(await signInWithLink(show, link, ctx)).toEqual({ ok: false, reason: 'used' });
    expect(await signInWithLink(show, signToken(key, 'stranger@nowhere.com'), ctx)).toEqual({ ok: false, reason: 'not_listed' });
    expect(await signInWithLink(show, signToken(otherKey, 'sam@acme.co.uk'), ctx)).toEqual({ ok: false, reason: 'unknown_key' });
    expect(await signInWithLink(show, signToken(key, 'sam@acme.co.uk', { now: Date.now() - 30 * 60_000 }), ctx)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('staff signing in', () => {
  it('get a code only when they have an account', async () => {
    const u = await makeUser({ email: 'ops@media10.co.uk' });
    await requestSignInCode('ops@media10.co.uk', ctx);
    await requestSignInCode('nobody@media10.co.uk', ctx);
    const user = await verifySignInCode('ops@media10.co.uk', codeIn((await lastEmailTo('ops@media10.co.uk'))?.text), ctx);
    expect(user.id).toBe(u.id);
    expect(await emailsTo('nobody@media10.co.uk')).toHaveLength(0);
  });

  it('cannot use an exhibitor storefront code to sign in to an account', async () => {
    const show = await makeShow();
    await makeUser({ email: 'both@acme.co.uk' });
    await addExhibitors(show.id, [{ email: 'both@acme.co.uk' }]);
    await requestExhibitorCode(show, 'both@acme.co.uk', ctx);
    const storefrontCode = codeIn((await lastEmailTo('both@acme.co.uk'))?.text);
    await expect(verifySignInCode('both@acme.co.uk', storefrontCode, ctx)).rejects.toThrow(/wrong or has expired/);
  });
});

describe('inviting a show team', () => {
  it('lets a show admin invite a team member with chosen rights', async () => {
    const show = await makeShow();
    const admin = await addStaff(show.id, 'show_admin');
    const { url } = await createInvitation(admin, { kind: 'show_staff', email: 'New.Person@media10.co.uk', showId: show.id, role: 'show_team', permissions: ['orders', 'not-a-right'] });
    const token = url.split('/invite/')[1];
    const found = await findInvitation(token);
    expect(found?.headline).toMatch(/Join the Demo Show 2027 team/);
    await expect(acceptInvitation(token, { name: 'New Person' }, ctx)).rejects.toThrow(/code we emailed/);
    await sendInvitationCode(token, ctx);
    const code = codeIn((await lastEmailTo('new.person@media10.co.uk'))?.text);
    await expect(acceptInvitation(token, { name: 'New Person', code, password: 'short' }, ctx)).rejects.toThrow(/at least 12/);
    const user = await acceptInvitation(token, { name: 'New Person', code, password: 'a long and sensible passphrase' }, ctx);
    const db = await getDb();
    const [row] = await db.select().from(showStaff).where(and(eq(showStaff.showId, show.id), eq(showStaff.userId, user.id)));
    expect(row).toMatchObject({ role: 'show_team', permissions: ['orders'] });
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(acceptInvitation(token, { name: 'Again', code }, ctx)).rejects.toThrow(/expired or has already been used/);
  });

  it('does not let a team member invite people', async () => {
    const show = await makeShow();
    const member = await addStaff(show.id, 'show_team', ['orders', 'exhibitors', 'reports', 'refunds']);
    await expect(createInvitation(member, { kind: 'show_staff', email: 'x@y.co', showId: show.id, role: 'show_admin' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
