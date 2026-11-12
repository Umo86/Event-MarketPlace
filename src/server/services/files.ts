import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, type DbLike } from '../db/client';
import { files, type FilePurpose } from '../db/schema';
import { invalid } from '../errors';
import { storage } from '../storage';
import { sanitiseSvg, UnsafeSvgError } from '../security/svg';
import type { Actor } from '../auth/actor';

export type FileRow = typeof files.$inferSelect;

export type ImageKind = 'png' | 'jpeg' | 'svg';
const MIME: Record<ImageKind, string> = { png: 'image/png', jpeg: 'image/jpeg', svg: 'image/svg+xml' };
const LABEL: Record<ImageKind, string> = { png: 'PNG', jpeg: 'JPEG', svg: 'SVG' };

function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 1024)).replace(/^﻿/, '').trimStart();
  return /^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head);
}

/** Works out what an uploaded image really is from its contents (never from its name). */
export async function detectImage(bytes: Uint8Array): Promise<ImageKind | null> {
  const { fileTypeFromBuffer } = await import('file-type');
  const t = await fileTypeFromBuffer(bytes.subarray(0, 4100));
  if (t?.mime === 'image/png') return 'png';
  if (t?.mime === 'image/jpeg') return 'jpeg';
  if (!t && looksLikeSvg(bytes)) return 'svg';
  return null;
}

/**
 * Checks and stores an uploaded image: real type in `allowed`, under `maxBytes`, SVGs cleaned.
 * Returns the new file's row. Keys are made here, never from the file's name.
 */
export async function storeImage(
  actor: Actor,
  input: { bytes: Uint8Array; name: string; purpose: FilePurpose; showId?: string | null; supplierId?: string | null; isPublic: boolean; allowed: ImageKind[]; maxBytes: number },
  opts: { tx?: DbLike } = {},
): Promise<FileRow> {
  if (!input.bytes.byteLength) throw invalid('That file is empty. Choose another.');
  if (input.bytes.byteLength > input.maxBytes) {
    throw invalid(`That file is too big. Use one under ${Math.round(input.maxBytes / 1024) >= 1024 ? `${input.maxBytes / 1024 / 1024} MB` : `${Math.round(input.maxBytes / 1024)} KB`}.`);
  }
  const kind = await detectImage(input.bytes);
  if (!kind || !input.allowed.includes(kind)) {
    const names = input.allowed.map((k) => LABEL[k]);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
    throw invalid(`Upload a ${list} file. This one isn't.`);
  }
  let body = input.bytes;
  if (kind === 'svg') {
    try {
      body = new TextEncoder().encode(sanitiseSvg(new TextDecoder('utf-8', { fatal: false }).decode(input.bytes)));
    } catch (err) {
      throw invalid(err instanceof UnsafeSvgError ? err.message : 'This SVG could not be used. Upload a PNG instead.');
    }
  }
  const ext = kind === 'jpeg' ? 'jpg' : kind;
  const storageKey = `${input.purpose}/${input.showId ?? input.supplierId ?? 'platform'}/${randomUUID()}`;
  const original = input.name.replace(/[^\w.\- ()]/g, '_').slice(0, 150) || `image.${ext}`;
  await storage().put(storageKey, body, MIME[kind]);
  const db = opts.tx ?? (await getDb());
  const [row] = await db
    .insert(files)
    .values({
      storageKey,
      originalName: original,
      mimeType: MIME[kind],
      sizeBytes: body.byteLength,
      sha256: createHash('sha256').update(body).digest('hex'),
      purpose: input.purpose,
      showId: input.showId ?? null,
      supplierId: input.supplierId ?? null,
      isPublic: input.isPublic,
      uploadedBy: actor.kind === 'user' ? actor.userId : null,
    })
    .returning();
  return row;
}

export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Checks and stores a private document (an insurance certificate, say): a real PDF, PNG or JPEG,
 * under 5 MB. Private files are only served after a permission check (src/app/files/[id]).
 */
export async function storeDocument(actor: Actor, input: { bytes: Uint8Array; name: string; supplierId: string }, opts: { tx?: DbLike } = {}): Promise<FileRow> {
  if (!input.bytes.byteLength) throw invalid('That file is empty. Choose another.');
  if (input.bytes.byteLength > DOCUMENT_MAX_BYTES) throw invalid('That file is too big. Use one under 5 MB.');
  const { fileTypeFromBuffer } = await import('file-type');
  const t = await fileTypeFromBuffer(input.bytes.subarray(0, 4100));
  const mime = t?.mime === 'application/pdf' || t?.mime === 'image/png' || t?.mime === 'image/jpeg' ? t.mime : null;
  if (!mime) throw invalid('Upload a PDF, PNG or JPEG file. This one isn’t.');
  const storageKey = `document/${input.supplierId}/${randomUUID()}`;
  const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
  const original = input.name.replace(/[^\w.\- ()]/g, '_').slice(0, 150) || `document.${ext}`;
  await storage().put(storageKey, input.bytes, mime);
  const db = opts.tx ?? (await getDb());
  const [row] = await db
    .insert(files)
    .values({
      storageKey,
      originalName: original,
      mimeType: mime,
      sizeBytes: input.bytes.byteLength,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
      purpose: 'document',
      supplierId: input.supplierId,
      isPublic: false,
      uploadedBy: actor.kind === 'user' ? actor.userId : null,
    })
    .returning();
  return row;
}

export async function getFile(id: string): Promise<FileRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await getDb();
  const [row] = await db.select().from(files).where(eq(files.id, id)).limit(1);
  return row && !row.deletedAt ? row : null;
}

/** The address of a public image. Every upload is a new file, so the address changes when the image does. */
export function fileUrl(id: string | null | undefined): string | null {
  return id ? `/files/${id}` : null;
}
