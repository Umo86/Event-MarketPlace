import 'server-only';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, or, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { DOCUMENT_KINDS, files, showStaff, shows, supplierDocuments, supplierUsers, suppliers, users } from '../db/schema';
import { authorize } from '../authz';
import { invalid, notFound } from '../errors';
import { writeAudit } from '../audit';
import { appUrl } from '../auth/login';
import { queueEmail } from '../email/send';
import { renderSimpleEmail } from '../email/simple';
import { kickJobs } from '../jobs/run';
import { storeDocument } from './files';
import { showIdsServedBy } from './categories';
import { DOCUMENT_KIND_LABEL, EXPIRY_REQUIRED, REMINDER_DAYS, daysBetween, documentState, expiryPhrase, todayInLondon, type DocumentState } from '@/lib/documents';
import { dateLong } from '@/lib/format';
import type { Actor, UserActor } from '../auth/actor';

/**
 * A supplier's documents, such as public liability insurance, each with an expiry date. The
 * supplier's owner or a super admin adds them; the supplier's people and the teams of the shows it
 * supplies can open them. 30 days before a document expires, its supplier and those shows' admins
 * are reminded, and every page about the supplier shows a warning.
 */

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as day, month and year.')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Enter a real date.');

export const documentSchema = z
  .object({
    kind: z.enum(DOCUMENT_KINDS),
    title: z
      .string()
      .trim()
      .max(120, 'Keep the name under 120 characters.')
      .transform((v) => v || null)
      .nullish(),
    expiresOn: isoDate.nullish().or(z.literal('').transform(() => null)),
  })
  .superRefine((v, ctx) => {
    if (EXPIRY_REQUIRED.has(v.kind) && !v.expiresOn) ctx.addIssue({ code: 'custom', path: ['expiresOn'], message: 'Insurance needs its expiry date.' });
    if (v.kind === 'other' && !v.title) ctx.addIssue({ code: 'custom', path: ['title'], message: 'Say what this document is.' });
  });

export type DocumentInput = z.input<typeof documentSchema>;

export type DocumentView = {
  id: string;
  kind: keyof typeof DOCUMENT_KIND_LABEL;
  title: string;
  fileId: string;
  fileName: string;
  expiresOn: string | null;
  state: DocumentState;
  expiry: string;
  createdAt: Date;
};

const UUID = /^[0-9a-f-]{36}$/i;

/** Marks an older document of the same kind as replaced when a newer one runs for longer. */
function withStates<T extends { id: string; kind: string; expiresOn: string | null; createdAt: Date }>(rows: T[], today: string) {
  return rows.map((r) => {
    const replaced = rows.some((o) => o.id !== r.id && o.kind === r.kind && r.kind !== 'other' && o.expiresOn && (!r.expiresOn || o.expiresOn > r.expiresOn));
    return { ...r, state: documentState(r.expiresOn, today, replaced), expiry: expiryPhrase(r.expiresOn, today) };
  });
}

export async function listDocuments(actor: Actor, supplierId: string, now = new Date()): Promise<DocumentView[]> {
  await authorize(actor, 'supplier.documents.view', { supplierId });
  const db = await getDb();
  const rows = await db
    .select({
      id: supplierDocuments.id,
      kind: supplierDocuments.kind,
      title: supplierDocuments.title,
      fileId: supplierDocuments.fileId,
      fileName: files.originalName,
      expiresOn: supplierDocuments.expiresOn,
      createdAt: supplierDocuments.createdAt,
    })
    .from(supplierDocuments)
    .innerJoin(files, eq(files.id, supplierDocuments.fileId))
    .where(eq(supplierDocuments.supplierId, supplierId))
    .orderBy(asc(supplierDocuments.kind), desc(supplierDocuments.expiresOn), desc(supplierDocuments.createdAt));
  return withStates(rows, todayInLondon(now));
}

/** The warnings to show at the top of a supplier's pages: anything expiring soon or expired. */
export function documentWarnings(docs: DocumentView[]) {
  return docs.filter((d) => d.state === 'expiring' || d.state === 'expired');
}

/** Whether there's public liability insurance in date: phase 2 shows this to show admins when they assign. */
export function hasInsurance(docs: DocumentView[]) {
  return docs.some((d) => d.kind === 'public_liability' && (d.state === 'valid' || d.state === 'expiring'));
}

export async function addDocument(actor: UserActor, supplierId: string, raw: DocumentInput, file: { bytes: Uint8Array; name: string }) {
  const input = documentSchema.parse(raw);
  await authorize(actor, 'supplier.documents.manage', { supplierId }, { write: true });
  if (!UUID.test(supplierId)) throw notFound();
  const db = await getDb();
  const [supplier] = await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!supplier) throw notFound();
  if (input.expiresOn && daysBetween(todayInLondon(), input.expiresOn) < 0) {
    throw invalid('That date has passed, so this document has already expired. Upload the current one.', { expiresOn: 'This date has passed.' });
  }
  const stored = await storeDocument(actor, { ...file, supplierId });
  const title = input.title ?? DOCUMENT_KIND_LABEL[input.kind];
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(supplierDocuments)
      .values({ supplierId, kind: input.kind, title, fileId: stored.id, expiresOn: input.expiresOn ?? null, uploadedBy: actor.userId })
      .returning();
    await writeAudit(tx, actor, {
      action: 'supplier.document_added',
      summary: `Added ${title} for ${supplier.name}${input.expiresOn ? `, expiring ${dateLong(`${input.expiresOn}T12:00:00Z`)}` : ''}`,
      entityType: 'supplier_document',
      entityId: row.id,
      supplierId,
      details: { kind: input.kind, expiresOn: input.expiresOn ?? null },
    });
    return row;
  });
}

export async function removeDocument(actor: UserActor, supplierId: string, documentId: string) {
  await authorize(actor, 'supplier.documents.manage', { supplierId }, { write: true });
  if (!UUID.test(documentId)) throw notFound();
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(supplierDocuments)
      .where(and(eq(supplierDocuments.id, documentId), eq(supplierDocuments.supplierId, supplierId)))
      .returning();
    if (!row) throw notFound();
    // The file stays (marked deleted) so the audit trail can still say what it was.
    await tx.update(files).set({ deletedAt: new Date() }).where(eq(files.id, row.fileId));
    await writeAudit(tx, actor, { action: 'supplier.document_removed', summary: `Removed ${row.title}`, entityType: 'supplier_document', entityId: documentId, supplierId });
  });
}

/**
 * The private file behind a document, if this person may open it. Used by the file route, so
 * documents are never open to anyone with the link.
 */
export async function documentFileFor(actor: Actor | null, fileId: string) {
  if (!actor || !UUID.test(fileId)) return null;
  const db = await getDb();
  const [doc] = await db.select({ supplierId: supplierDocuments.supplierId }).from(supplierDocuments).where(eq(supplierDocuments.fileId, fileId)).limit(1);
  if (!doc) return null;
  try {
    await authorize(actor, 'supplier.documents.view', { supplierId: doc.supplierId });
    return doc;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reminders (a daily job)
// ---------------------------------------------------------------------------

/**
 * Emails each supplier's people and the admins of the shows it supplies when a document is 30
 * days or fewer from its expiry date. Each expiry date is reminded about once; a replaced document
 * is skipped. Emails only go out once Resend is set up; until then they are recorded as not sent.
 */
export async function sendDocumentReminders(now = new Date()) {
  const today = todayInLondon(now);
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + REMINDER_DAYS * 86_400_000).toISOString().slice(0, 10);
  const db = await getDb();
  const due = await db
    .select({ doc: supplierDocuments, supplierName: suppliers.name })
    .from(supplierDocuments)
    .innerJoin(suppliers, eq(suppliers.id, supplierDocuments.supplierId))
    .where(
      and(
        isNotNull(supplierDocuments.expiresOn),
        gte(supplierDocuments.expiresOn, today),
        lte(supplierDocuments.expiresOn, until),
        or(isNull(supplierDocuments.reminderSentFor), ne(supplierDocuments.reminderSentFor, supplierDocuments.expiresOn)),
        // Skip one already replaced by a newer document of the same kind.
        sql`not exists (select 1 from supplier_documents newer where newer.supplier_id = ${supplierDocuments.supplierId} and newer.kind = ${supplierDocuments.kind} and newer.kind <> 'other' and newer.expires_on > ${supplierDocuments.expiresOn})`,
      ),
    );
  if (!due.length) return { reminded: 0, emails: 0 };

  const supplierIds = [...new Set(due.map((d) => d.doc.supplierId))];
  const members = await db
    .select({ supplierId: supplierUsers.supplierId, email: users.email })
    .from(supplierUsers)
    .innerJoin(users, eq(users.id, supplierUsers.userId))
    .where(and(inArray(supplierUsers.supplierId, supplierIds), eq(users.status, 'active')));
  const served = await showIdsServedBy(supplierIds);
  const showIds = [...new Set([...served.values()].flat())];
  const admins = showIds.length
    ? await db
        .select({ showId: showStaff.showId, email: users.email, showName: shows.name })
        .from(showStaff)
        .innerJoin(users, eq(users.id, showStaff.userId))
        .innerJoin(shows, eq(shows.id, showStaff.showId))
        .where(and(inArray(showStaff.showId, showIds), eq(showStaff.role, 'show_admin'), eq(users.status, 'active')))
    : [];

  let emails = 0;
  for (const { doc, supplierName } of due) {
    const when = dateLong(`${doc.expiresOn}T12:00:00Z`);
    const phrase = expiryPhrase(doc.expiresOn, today).toLowerCase();
    await db.transaction(async (tx) => {
      // Claim it first, so two runs at once never send it twice.
      const [claimed] = await tx
        .update(supplierDocuments)
        .set({ reminderSentFor: doc.expiresOn })
        .where(and(eq(supplierDocuments.id, doc.id), or(isNull(supplierDocuments.reminderSentFor), ne(supplierDocuments.reminderSentFor, doc.expiresOn!))))
        .returning({ id: supplierDocuments.id });
      if (!claimed) return;
      for (const email of new Set(members.filter((m) => m.supplierId === doc.supplierId).map((m) => m.email))) {
        const body = renderSimpleEmail({
          heading: `Your ${doc.title.toLowerCase()} ${phrase}`,
          paragraphs: [
            `The ${doc.title.toLowerCase()} on your Event MarketPlace account ${phrase}, on ${when}.`,
            'Upload the renewed document before then, so the show teams you supply have a current copy.',
          ],
          button: { label: 'Upload the new document', url: appUrl(`/supplier/${doc.supplierId}/documents`) },
        });
        await queueEmail({ to: email, templateKey: 'supplier_document_expiring', category: 'reminder', subject: `${doc.title} ${phrase}`, ...body }, { tx });
        emails++;
      }
      const showsFor = served.get(doc.supplierId) ?? [];
      // One email per person, even if they run several shows this supplier serves.
      const seen = new Set<string>();
      for (const a of admins.filter((x) => showsFor.includes(x.showId) && !seen.has(x.email) && seen.add(x.email))) {
        const body = renderSimpleEmail({
          heading: `${supplierName}: ${doc.title.toLowerCase()} ${phrase}`,
          paragraphs: [`${supplierName} supplies ${a.showName}. Their ${doc.title.toLowerCase()} ${phrase}, on ${when}.`, 'We’ve reminded them to upload the renewed document. You may want to check they do.'],
          button: { label: `Open ${supplierName}`, url: appUrl(`/admin/shows/${a.showId}/categories`) },
        });
        await queueEmail({ to: a.email, showId: a.showId, templateKey: 'supplier_document_expiring_admin', category: 'reminder', subject: `${supplierName}: ${doc.title} ${phrase}`, ...body }, { tx });
        emails++;
      }
    });
  }
  await kickJobs();
  return { reminded: due.length, emails };
}

/** Rows for the documents panel (plain values, safe to pass to the browser). */
export function documentRows(docs: DocumentView[]) {
  return docs.map((d) => ({ id: d.id, kind: d.kind, title: d.title, fileId: d.fileId, fileName: d.fileName, expiresOn: d.expiresOn, expiryText: d.expiry, state: d.state, addedOn: dateLong(d.createdAt) }));
}
