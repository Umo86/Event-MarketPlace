import { getFile } from '@/server/services/files';
import { contentDisposition, storage } from '@/server/storage';

/**
 * Serves uploaded files. Public files (logos, banners, product photos) are open so they work in
 * emails. Each upload has its own address and never changes, so they can be cached for good.
 * Private files (invoices, from phase 2) will need a permission check here.
 */
export async function GET(_req: Request, ctx: RouteContext<'/files/[id]'>) {
  const { id } = await ctx.params;
  const file = await getFile(id);
  if (!file || !file.isPublic) return new Response('Not found', { status: 404 });
  const body = await storage().stream(file.storageKey);
  if (!body) return new Response('Not found', { status: 404 });
  return new Response(body, {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Length': String(file.sizeBytes),
      'Content-Disposition': contentDisposition(file.originalName, true),
      'X-Content-Type-Options': 'nosniff',
      // SVGs were cleaned on upload; this stops anything in a file running even if opened directly.
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}
