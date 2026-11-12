import { getExhibitor } from '@/server/auth/current';
import { getShowBySlug } from '@/server/services/shows';
import { invoiceFileFor } from '@/server/services/invoices';
import { contentDisposition, storage } from '@/server/storage';

/**
 * An exhibitor's own invoice or credit note. It lives under the show's address because the
 * storefront sign-in only reaches there (DECISIONS.md). Anyone else gets "not found".
 */
export async function GET(_req: Request, ctx: RouteContext<'/[show]/orders/[orderId]/files/[fileId]'>) {
  const { show: slug, fileId } = await ctx.params;
  const show = await getShowBySlug(slug);
  if (!show) return new Response('Not found', { status: 404 });
  const exhibitor = await getExhibitor(show.id);
  const file = await invoiceFileFor(exhibitor, fileId);
  if (!file) return new Response('Not found', { status: 404 });
  const body = await storage().stream(file.storageKey);
  if (!body) return new Response('Not found', { status: 404 });
  return new Response(body, {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Length': String(file.sizeBytes),
      'Content-Disposition': contentDisposition(file.originalName, false),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
}
