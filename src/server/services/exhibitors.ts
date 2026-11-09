import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type DbLike } from '../db/client';
import { exhibitorContacts, exhibitorSessions, halls, shows, standTypes, stands } from '../db/schema';
import { authorize } from '../authz';
import { invalid } from '../errors';
import { writeAudit } from '../audit';
import { assertSafeZip } from '../security/zip';
import { parseDelimited } from '@/lib/csv-parse';
import { isValidEmail, normaliseEmail } from '../auth/login';
import type { Actor } from '../auth/actor';

/**
 * A show's exhibitor list (DECISIONS.md, "Exhibitors are a list, not accounts"): one row per contact
 * per stand. It arrives two ways, both through applyList(): a show admin uploads Excel or CSV (and
 * sees what would change first), or BluePrint sends the whole list with the show's key.
 * The same contact keeps the same row across uploads, matched by email plus stand number.
 */

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_ROWS = 5000;

export type ListRow = {
  company: string;
  stand: string;
  hall: string;
  standType: string;
  name: string;
  email: string;
  phone: string;
  externalId?: string | null;
};

// ---------------------------------------------------------------------------
// Reading a spreadsheet (adapted from BluePrint's exhibitor-import.ts)
// ---------------------------------------------------------------------------

/** Column headings recognised, whatever their case or punctuation. */
const FIELD_ALIASES: Record<keyof Omit<ListRow, 'externalId'>, string[]> = {
  company: ['company', 'company name', 'exhibitor', 'exhibitor name', 'organisation', 'organization', 'business name'],
  stand: ['stand', 'stand number', 'stand no', 'stand ref', 'booth', 'booth number'],
  hall: ['hall', 'zone', 'area'],
  standType: ['stand type', 'type', 'package', 'exhibitor type', 'stand package'],
  name: ['contact', 'contact name', 'main contact', 'main contact name', 'name', 'full name'],
  email: ['email', 'contact email', 'e mail', 'email address', 'main contact email'],
  phone: ['phone', 'telephone', 'tel', 'contact phone', 'mobile', 'phone number'],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? '').join('').trim();
    if ('text' in o) return cellToString(o.text);
    if ('result' in o) return cellToString(o.result);
    if ('hyperlink' in o) return cellToString(String(o.hyperlink).replace(/^mailto:/i, ''));
  }
  return '';
}

/** Reads the first sheet of an .xlsx file, or a CSV, into rows of text. */
export async function readSpreadsheet(name: string, bytes: Uint8Array): Promise<string[][]> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw invalid('That file is too big. Keep it under 4 MB.');
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip || /\.xlsx$/i.test(name)) {
    if (!isZip) throw invalid('That file is not a valid Excel spreadsheet. Save it again as .xlsx or CSV.');
    try {
      assertSafeZip(bytes);
    } catch (err) {
      throw invalid(err instanceof Error ? err.message : 'That spreadsheet could not be opened.');
    }
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    } catch {
      throw invalid('That spreadsheet could not be opened. Save it again as .xlsx or CSV and try again.');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw invalid('That spreadsheet has no sheets.');
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length > MAX_ROWS + 1) return;
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(Array.from(values, cellToString));
    });
    return rows.filter((r) => r.some((c) => c !== ''));
  }
  if (/\.xls$/i.test(name)) throw invalid('Old .xls files are not supported. Save it as .xlsx or CSV.');
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (text.includes('\u0000')) throw invalid('That file does not look like a CSV or Excel file.');
  try {
    return parseDelimited(text, MAX_ROWS + 1);
  } catch (err) {
    throw invalid(err instanceof Error ? err.message : 'That file could not be read.');
  }
}

export type ReadRow = ListRow & { line: number; problems: string[] };

/** Turns spreadsheet rows into list rows, finding columns by their headings. */
export function rowsFromSheet(sheet: string[][]): { rows: ReadRow[]; missingColumns: string[]; recognised: string[] } {
  if (sheet.length < 2) throw invalid('The file needs a heading row and at least one exhibitor.');
  if (sheet.length - 1 > MAX_ROWS) throw invalid(`Upload up to ${MAX_ROWS.toLocaleString('en-GB')} rows at a time.`);
  const [header, ...body] = sheet;
  const cols: Partial<Record<keyof typeof FIELD_ALIASES, number>> = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [keyof typeof FIELD_ALIASES, string[]][]) {
      if (cols[field] === undefined && aliases.includes(n)) cols[field] = i;
    }
  });
  const missingColumns = (['company', 'stand', 'email'] as const).filter((f) => cols[f] === undefined);
  const get = (r: string[], f: keyof typeof FIELD_ALIASES) => (cols[f] === undefined ? '' : (r[cols[f]!] ?? '').replace(/\s+/g, ' ').trim());
  const rows = missingColumns.length
    ? []
    : body.map((r, i) => {
        const row: ReadRow = {
          line: i + 2,
          company: get(r, 'company').slice(0, 200),
          stand: get(r, 'stand').slice(0, 40),
          hall: get(r, 'hall').slice(0, 80),
          standType: get(r, 'standType').slice(0, 80),
          name: get(r, 'name').slice(0, 120),
          email: normaliseEmail(get(r, 'email')),
          phone: get(r, 'phone').slice(0, 40),
          problems: [],
        };
        return checkRow(row);
      });
  return { rows, missingColumns: missingColumns.map(String), recognised: Object.keys(cols) };
}

function checkRow<T extends ListRow & { problems: string[] }>(row: T): T {
  if (!row.company) row.problems.push('Add the company name.');
  if (!row.stand) row.problems.push('Add the stand number.');
  if (!row.email) row.problems.push('Add an email address: exhibitors sign in with it.');
  else if (!isValidEmail(row.email)) row.problems.push(`"${row.email.slice(0, 60)}" isn’t a valid email address.`);
  return row;
}

// ---------------------------------------------------------------------------
// Working out and applying changes
// ---------------------------------------------------------------------------

export type PlanEntry = { line: number | null; company: string; stand: string; email: string; name: string; action: 'add' | 'update' | 'same' | 'remove' | 'skip'; changes: string[]; problems: string[] };

export type ListPlan = {
  entries: PlanEntry[];
  newHalls: string[];
  newStandTypes: string[];
  counts: { add: number; update: number; same: number; remove: number; skip: number };
};

const lower = (s: string) => s.trim().toLowerCase();
const typeKey = (s: string) =>
  lower(s)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

async function loadCurrent(db: DbLike, showId: string) {
  const [hallRows, typeRows, standRows, contactRows] = await Promise.all([
    db.select().from(halls).where(eq(halls.showId, showId)),
    db.select().from(standTypes).where(eq(standTypes.showId, showId)),
    db.select().from(stands).where(eq(stands.showId, showId)),
    db.select().from(exhibitorContacts).where(eq(exhibitorContacts.showId, showId)),
  ]);
  const hallByName = new Map(hallRows.map((h) => [lower(h.name), h]));
  const typeByName = new Map<string, (typeof typeRows)[number]>();
  for (const t of typeRows) {
    typeByName.set(lower(t.name), t);
    typeByName.set(t.key, t);
  }
  const standByNumber = new Map(standRows.map((s) => [lower(s.number), s]));
  const contactByKey = new Map(contactRows.map((c) => [`${c.standId}|${c.email}`, c]));
  return { hallRows, typeRows, standRows, contactRows, hallByName, typeByName, standByNumber, contactByKey };
}

/** What a list would change, without changing anything. `replace` also removes contacts not in the list. */
export async function planList(db: DbLike, showId: string, rows: (ListRow & { line?: number; problems?: string[] })[], opts: { replace: boolean }): Promise<ListPlan> {
  const cur = await loadCurrent(db, showId);
  const hallById = new Map(cur.hallRows.map((h) => [h.id, h.name]));
  const typeById = new Map(cur.typeRows.map((t) => [t.id, t.name]));
  const entries: PlanEntry[] = [];
  const newHalls = new Set<string>();
  const newStandTypes = new Set<string>();
  const seen = new Set<string>();
  for (const r of rows) {
    const base = { line: r.line ?? null, company: r.company, stand: r.stand, email: r.email, name: r.name };
    const problems = [...(r.problems ?? [])];
    const key = `${lower(r.stand)}|${r.email}`;
    if (!problems.length && seen.has(key)) problems.push('This contact and stand are in the list twice. Only the first is used.');
    if (problems.length) {
      entries.push({ ...base, action: 'skip', changes: [], problems });
      continue;
    }
    seen.add(key);
    if (r.hall && !cur.hallByName.has(lower(r.hall))) newHalls.add(r.hall);
    if (r.standType && !cur.typeByName.has(lower(r.standType)) && !cur.typeByName.has(typeKey(r.standType))) newStandTypes.add(r.standType);
    const stand = cur.standByNumber.get(lower(r.stand));
    const contact = stand ? cur.contactByKey.get(`${stand.id}|${r.email}`) : undefined;
    if (!stand || !contact) {
      entries.push({ ...base, action: 'add', changes: stand ? [] : ['New stand'], problems: [] });
      continue;
    }
    const changes: string[] = [];
    if (stand.companyName !== r.company) changes.push(`Company: ${stand.companyName} → ${r.company}`);
    const hallName = stand.hallId ? hallById.get(stand.hallId) ?? '' : '';
    if (r.hall && lower(hallName) !== lower(r.hall)) changes.push(`Hall: ${hallName || 'none'} → ${r.hall}`);
    const typeName = stand.standTypeId ? typeById.get(stand.standTypeId) ?? '' : '';
    if (r.standType && lower(typeName) !== lower(r.standType) && typeKey(typeName) !== typeKey(r.standType)) changes.push(`Stand type: ${typeName || 'none'} → ${r.standType}`);
    if (r.name && contact.name !== r.name) changes.push(`Contact name: ${contact.name || 'none'} → ${r.name}`);
    if (r.phone && (contact.phone ?? '') !== r.phone) changes.push('Phone number');
    if (stand.status !== 'active' || contact.status !== 'active') changes.push('Back on the list');
    entries.push({ ...base, action: changes.length ? 'update' : 'same', changes, problems: [] });
  }
  if (opts.replace) {
    const standNumber = new Map(cur.standRows.map((s) => [s.id, s]));
    for (const c of cur.contactRows) {
      if (c.status !== 'active') continue;
      const s = standNumber.get(c.standId);
      if (!s || seen.has(`${lower(s.number)}|${c.email}`)) continue;
      entries.push({ line: null, company: s.companyName, stand: s.number, email: c.email, name: c.name, action: 'remove', changes: ['Not in the new list'], problems: [] });
    }
  }
  const counts = { add: 0, update: 0, same: 0, remove: 0, skip: 0 };
  for (const e of entries) counts[e.action]++;
  return { entries, newHalls: [...newHalls], newStandTypes: [...newStandTypes], counts };
}

/**
 * Applies a list inside the caller's transaction, with the show row locked so two changes to the
 * list never run at once. Rows taken off are marked removed, never deleted, so past orders keep
 * their stand and contact; their storefront sign-ins end.
 */
export async function applyList(tx: DbLike, showId: string, rows: (ListRow & { problems?: string[] })[], opts: { replace: boolean; source: 'upload' | 'blueprint' }) {
  await tx.select({ id: shows.id }).from(shows).where(eq(shows.id, showId)).for('update');
  const plan = await planList(tx, showId, rows, opts);
  const cur = await loadCurrent(tx, showId);
  const hallId = async (name: string) => {
    if (!name) return null;
    const found = cur.hallByName.get(lower(name));
    if (found) return found.id;
    const [h] = await tx.insert(halls).values({ showId, name, sort: cur.hallByName.size }).returning();
    cur.hallByName.set(lower(name), h);
    return h.id;
  };
  const typeId = async (name: string) => {
    if (!name) return null;
    const found = cur.typeByName.get(lower(name)) ?? cur.typeByName.get(typeKey(name));
    if (found) return found.id;
    const key = typeKey(name) || `type_${cur.typeByName.size}`;
    const [t] = await tx
      .insert(standTypes)
      .values({ showId, key, name, sort: cur.typeRows.length + cur.typeByName.size })
      .onConflictDoUpdate({ target: [standTypes.showId, standTypes.key], set: { name } })
      .returning();
    cur.typeByName.set(lower(name), t);
    cur.typeByName.set(key, t);
    return t.id;
  };
  const kept = new Set<string>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.problems?.length || !r.company || !r.stand || !isValidEmail(r.email)) continue;
    const key = `${lower(r.stand)}|${r.email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let stand = cur.standByNumber.get(lower(r.stand));
    const values = {
      companyName: r.company,
      status: 'active' as const,
      source: opts.source,
      ...(r.hall ? { hallId: await hallId(r.hall) } : {}),
      ...(r.standType ? { standTypeId: await typeId(r.standType) } : {}),
    };
    if (!stand) {
      [stand] = await tx.insert(stands).values({ showId, number: r.stand, ...values }).returning();
      cur.standByNumber.set(lower(r.stand), stand);
    } else if (stand.companyName !== r.company || stand.status !== 'active' || (r.hall && values.hallId !== stand.hallId) || (r.standType && values.standTypeId !== stand.standTypeId)) {
      [stand] = await tx.update(stands).set(values).where(eq(stands.id, stand.id)).returning();
      cur.standByNumber.set(lower(r.stand), stand);
    }
    const existing = cur.contactByKey.get(`${stand.id}|${r.email}`);
    if (!existing) {
      const [c] = await tx
        .insert(exhibitorContacts)
        .values({ showId, standId: stand.id, email: r.email, name: r.name, phone: r.phone || null, externalId: r.externalId ?? null })
        .returning();
      kept.add(c.id);
      cur.contactByKey.set(`${stand.id}|${r.email}`, c);
    } else {
      kept.add(existing.id);
      if (existing.status !== 'active' || (r.name && existing.name !== r.name) || (r.phone && existing.phone !== r.phone) || (r.externalId && existing.externalId !== r.externalId)) {
        await tx
          .update(exhibitorContacts)
          .set({ status: 'active', ...(r.name ? { name: r.name } : {}), ...(r.phone ? { phone: r.phone } : {}), ...(r.externalId ? { externalId: r.externalId } : {}) })
          .where(eq(exhibitorContacts.id, existing.id));
      }
    }
  }
  if (opts.replace) {
    const gone = cur.contactRows.filter((c) => c.status === 'active' && !kept.has(c.id));
    for (const c of gone) await tx.update(exhibitorContacts).set({ status: 'removed' }).where(eq(exhibitorContacts.id, c.id));
    // Their storefront sign-ins end with them (unless the same email is still on another stand).
    const goneEmails = [...new Set(gone.map((c) => c.email))];
    for (const email of goneEmails) {
      const [still] = await tx
        .select({ id: exhibitorContacts.id })
        .from(exhibitorContacts)
        .where(and(eq(exhibitorContacts.showId, showId), eq(exhibitorContacts.email, email), eq(exhibitorContacts.status, 'active')))
        .limit(1);
      if (!still) await tx.update(exhibitorSessions).set({ revokedAt: new Date() }).where(and(eq(exhibitorSessions.showId, showId), eq(exhibitorSessions.email, email)));
    }
    // A stand nobody is on any more leaves the list too.
    await tx.execute(sql`
      update stands set status = 'removed', updated_at = now()
      where show_id = ${showId} and status = 'active'
        and not exists (select 1 from exhibitor_contacts c where c.stand_id = stands.id and c.status = 'active')`);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Upload (show admins): preview, then apply
// ---------------------------------------------------------------------------

export async function previewUpload(actor: Actor, showId: string, file: { name: string; bytes: Uint8Array }, opts: { replace: boolean }) {
  await authorize(actor, 'exhibitors.manage', { showId });
  const sheet = await readSpreadsheet(file.name, file.bytes);
  const { rows, missingColumns, recognised } = rowsFromSheet(sheet);
  if (missingColumns.length) {
    const names: Record<string, string> = { company: 'Company', stand: 'Stand', email: 'Email' };
    throw invalid(`We couldn’t find these columns: ${missingColumns.map((c) => names[c] ?? c).join(', ')}. Check the heading row and try again.`);
  }
  const db = await getDb();
  const plan = await planList(db, showId, rows, opts);
  return { rows, plan, recognised };
}

export const listRowSchema = z.object({
  company: z.string().trim().max(200),
  stand: z.string().trim().max(40),
  hall: z.string().trim().max(80).default(''),
  standType: z.string().trim().max(80).default(''),
  name: z.string().trim().max(120).default(''),
  email: z.string().trim().toLowerCase().max(254),
  phone: z.string().trim().max(40).default(''),
});

export const applyUploadSchema = z.object({
  showId: z.string().uuid(),
  replace: z.boolean(),
  fileName: z.string().trim().max(200).default('upload'),
  rows: z.array(listRowSchema).min(1, 'There’s nothing to add.').max(MAX_ROWS),
});

export async function applyUpload(actor: Actor, input: z.infer<typeof applyUploadSchema>) {
  await authorize(actor, 'exhibitors.manage', { showId: input.showId }, { write: true });
  const rows = input.rows.map((r) => checkRow({ ...r, problems: [] as string[] }));
  const db = await getDb();
  return db.transaction(async (tx) => {
    const plan = await applyList(tx, input.showId, rows, { replace: input.replace, source: 'upload' });
    const c = plan.counts;
    await writeAudit(tx, actor, {
      action: 'exhibitors.uploaded',
      summary: `Uploaded the exhibitor list from ${input.fileName}: ${c.add} added, ${c.update} changed, ${c.remove} removed, ${c.skip} skipped`,
      entityType: 'show',
      entityId: input.showId,
      showId: input.showId,
      details: { counts: c, replace: input.replace },
    });
    return plan.counts;
  });
}

// ---------------------------------------------------------------------------
// Viewing
// ---------------------------------------------------------------------------

export async function listExhibitors(actor: Actor, showId: string, opts: { includeRemoved?: boolean } = {}) {
  await authorize(actor, 'exhibitors.view', { showId });
  const db = await getDb();
  const rows = await db
    .select({
      contactId: exhibitorContacts.id,
      email: exhibitorContacts.email,
      name: exhibitorContacts.name,
      phone: exhibitorContacts.phone,
      contactStatus: exhibitorContacts.status,
      standId: stands.id,
      stand: stands.number,
      company: stands.companyName,
      standStatus: stands.status,
      hall: halls.name,
      standType: standTypes.name,
    })
    .from(exhibitorContacts)
    .innerJoin(stands, eq(stands.id, exhibitorContacts.standId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .leftJoin(standTypes, eq(standTypes.id, stands.standTypeId))
    .where(and(eq(exhibitorContacts.showId, showId), opts.includeRemoved ? undefined : eq(exhibitorContacts.status, 'active')))
    .orderBy(asc(stands.companyName), asc(stands.number), asc(exhibitorContacts.email));
  return rows;
}

export async function exhibitorCounts(actor: Actor, showId: string) {
  await authorize(actor, 'show.view', { showId });
  const db = await getDb();
  const [row] = await db
    .select({
      contacts: sql<number>`count(*) filter (where ${exhibitorContacts.status} = 'active')`.mapWith(Number),
      stands: sql<number>`count(distinct ${exhibitorContacts.standId}) filter (where ${exhibitorContacts.status} = 'active')`.mapWith(Number),
    })
    .from(exhibitorContacts)
    .where(eq(exhibitorContacts.showId, showId));
  return row ?? { contacts: 0, stands: 0 };
}

/** The heading row for a template file. */
export function templateCsv(): string {
  return ['Company,Stand,Hall,Stand type,Contact name,Email,Phone', 'Acme Displays Ltd,B12,Hall 1,Shell scheme,Sam Patel,sam@example.com,020 7946 0000'].join('\r\n');
}

