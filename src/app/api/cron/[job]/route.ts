import { timingSafeEqual } from 'node:crypto';
import { env } from '@/server/env';
import { sweep } from '@/server/jobs/run';

/** Vercel Cron calls /api/cron/jobs with the CRON_SECRET as a bearer token (vercel.json). */
export const maxDuration = 60;

function authorised(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request, ctx: RouteContext<'/api/cron/[job]'>) {
  const { job } = await ctx.params;
  if (!authorised(req)) return new Response('Not found', { status: 404 });
  if (job !== 'jobs') return new Response('Not found', { status: 404 });
  const result = await sweep();
  return Response.json({ ok: true, ...result });
}
