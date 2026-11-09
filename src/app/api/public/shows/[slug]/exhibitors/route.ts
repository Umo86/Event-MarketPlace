import { consumeRateLimit } from '@/server/security/rate-limit';
import { readSyncBody, showForKey, syncFromBlueprint } from '@/server/services/blueprint-sync';

/**
 * BluePrint sends a show's whole exhibitor list here, with the show's key as a bearer token.
 * Guide for BluePrint's side: docs/blueprint.md. Nothing changes unless the whole request is right.
 */
const MAX_BYTES = 4 * 1024 * 1024;

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

function clientIp(req: Request) {
  return req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function POST(req: Request, ctx: RouteContext<'/api/public/shows/[slug]/exhibitors'>) {
  const { slug } = await ctx.params;
  const ip = clientIp(req);
  // Limited per network before the key is checked, so guessing keys is slow.
  const byIp = await consumeRateLimit(`list-sync:ip:${ip}`, 120, 3600);
  if (!byIp.allowed) return json(429, { error: 'Too many requests. Wait a few minutes, then send the whole list again.' }, { 'Retry-After': String(byIp.retryAfterSeconds) });

  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return json(415, { error: 'Send the list as JSON (Content-Type: application/json).' });
  }
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return json(413, { error: 'That’s over 4 MB. Leave out anything the marketplace doesn’t need.' });

  const auth = req.headers.get('authorization') ?? '';
  const key = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? null;
  const show = await showForKey(slug, key);
  if (!show) return json(401, { error: 'The key is wrong, or it has been replaced. Make a new one on the show’s Exhibitors page.' });

  const byShow = await consumeRateLimit(`list-sync:show:${show.id}`, 60, 3600);
  if (!byShow.allowed) return json(429, { error: 'Too many updates for this show. Wait a few minutes, then send the whole list again.' }, { 'Retry-After': String(byShow.retryAfterSeconds) });

  const text = await req.text();
  if (text.length > MAX_BYTES) return json(413, { error: 'That’s over 4 MB. Leave out anything the marketplace doesn’t need.' });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'That isn’t valid JSON.' });
  }
  const read = readSyncBody(body);
  if (!read.ok) return json(read.status, { error: read.error });
  try {
    const result = await syncFromBlueprint(show, read.rows, { ip, userAgent: req.headers.get('user-agent') });
    return json(200, { ...result, skipped: result.skipped + read.skipped });
  } catch (err) {
    console.error('Exhibitor list from BluePrint failed', err instanceof Error ? err.message : err);
    return json(500, { error: 'Something went wrong on our side. Try again in a minute.' });
  }
}
