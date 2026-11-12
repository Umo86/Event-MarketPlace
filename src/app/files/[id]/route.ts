import { getFile } from '@/server/services/files';
import { documentFileFor } from '@/server/services/documents';
import { getCurrentAuth } from '@/server/auth/current';
import { contentDisposition, storage } from '@/server/storage';

/**
 * Serves uploaded files. Public files (logos, banners, product photos) are open so they work in
 * emails. Each upload has its own address and never changes, so they can be cached for good.
 * Private files (supplier documents) are served only to someone signed in who may see them, and
 * never cached; anyone else gets "not found".
 */
const SAFE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  // SVGs were cleaned on upload; this stops anything in a file running even if opened directly.
  'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
};

export async function GET(_req: Request, ctx: RouteContext<'/files/[id]'>) {
  const { id } = await ctx.params;
  const file = await getFile(id);
  if (!file) return new Response('Not found', { status: 404 });
  if (!file.isPublic) {
    const auth = await getCurrentAuth();
    const signedIn = auth && !auth.needsSecondFactor && !auth.needsTwoFactorSetup && !auth.needsPasswordChange ? auth.actor : null;
    if (file.purpose !== 'document' || !(await documentFileFor(signedIn, file.id))) return new Response('Not found', { status: 404 });
  }
  const body = await storage().stream(file.storageKey);
  if (!body) return new Response('Not found', { status: 404 });
  return new Response(body, {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Length': String(file.sizeBytes),
      // A PDF downloads: browsers can't show one inside the sandbox below.
      'Content-Disposition': contentDisposition(file.originalName, file.mimeType.startsWith('image/')),
      ...SAFE_HEADERS,
      ...(file.isPublic
        ? { 'Cache-Control': 'public, max-age=31536000, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin' }
        : { 'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer' }),
    },
  });
}
