import 'server-only';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { getDb, type DbLike } from '../db/client';
import { jobs } from '../db/schema';

/**
 * Background jobs in Postgres (from Billie): no extra service to run or pay for. A job is claimed
 * with FOR UPDATE SKIP LOCKED under a lease, so two workers never take the same one; a worker that
 * dies leaves the lease to run out and the job is tried again. Failures back off; after the last
 * try the job stays "failed" for a person to see. Work starts straight after the request that
 * queued it (kickJobs) and Vercel Cron sweeps the queue (/api/cron/jobs).
 */
export const JOB_KINDS = ['send_email', 'purge_expired'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export type Job = typeof jobs.$inferSelect;

export const LEASE_MS = 5 * 60_000;

export function backoffMs(attempts: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

async function rows<T>(db: DbLike, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

/**
 * Queues a job. With a dedupeKey it is queued once while one with the same key is waiting or
 * running; with `once` as well, never again while any job with that key is kept.
 * Pass `tx` to queue it in the same transaction as the change that needs it.
 */
export async function enqueue(
  kind: JobKind,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; dedupeKey?: string; once?: boolean; maxAttempts?: number; tx?: DbLike } = {},
): Promise<string | null> {
  const db = opts.tx ?? (await getDb());
  const key = opts.dedupeKey ?? null;
  const inserted = await rows<{ id: string }>(
    db,
    sql`
    insert into jobs (kind, payload, run_at, dedupe_key, max_attempts)
    select ${kind}::text, ${JSON.stringify(payload)}::jsonb,
           ${(opts.runAt ?? new Date()).toISOString()}::timestamptz,
           ${key}::text, ${opts.maxAttempts ?? 5}::int
    where not ${Boolean(opts.once && key)}::boolean
       or not exists (select 1 from jobs where dedupe_key = ${key}::text)
    on conflict (dedupe_key) where dedupe_key is not null and status in ('queued', 'running')
    do nothing
    returning id`,
  );
  return inserted[0]?.id ?? null;
}

/**
 * Takes up to `limit` due jobs: queued and due, or running with an expired lease and tries left.
 * A job whose lease ran out on its last try is failed instead, so it cannot run for ever.
 */
export async function claim(limit: number, now = new Date()): Promise<Job[]> {
  const db = await getDb();
  const at = now.toISOString();
  await db.execute(sql`
    update jobs
    set status = 'failed', locked_until = null, finished_at = ${at}, updated_at = now(),
        last_error = 'It ran out of time on its last try.'
    where status = 'running' and locked_until < ${at} and attempts >= max_attempts`);
  const lease = new Date(now.getTime() + LEASE_MS).toISOString();
  const claimed = await rows<{ id: string }>(
    db,
    sql`
    update jobs set status = 'running', attempts = attempts + 1, locked_until = ${lease}, updated_at = now()
    where id in (
      select id from jobs
      where (status = 'queued' and run_at <= ${at})
         or (status = 'running' and locked_until < ${at} and attempts < max_attempts)
      order by run_at
      limit ${limit}
      for update skip locked
    )
    returning id`,
  );
  if (!claimed.length) return [];
  return db
    .select()
    .from(jobs)
    .where(
      inArray(
        jobs.id,
        claimed.map((r) => String(r.id)),
      ),
    );
}

export async function complete(id: string): Promise<void> {
  const db = await getDb();
  await db
    .update(jobs)
    .set({ status: 'done', lockedUntil: null, finishedAt: new Date(), lastError: null })
    .where(and(eq(jobs.id, id), eq(jobs.status, 'running')));
}

/** A failure that trying again cannot fix (a missing record): no more attempts. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

function errorText(err: unknown) {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}

export async function failJob(job: Job, err: unknown, now = new Date()): Promise<'retry' | 'failed'> {
  const db = await getDb();
  const permanent = err instanceof PermanentJobError;
  if (permanent || job.attempts >= job.maxAttempts) {
    await db.update(jobs).set({ status: 'failed', lockedUntil: null, lastError: errorText(err), finishedAt: now }).where(eq(jobs.id, job.id));
    return 'failed';
  }
  await db
    .update(jobs)
    .set({ status: 'queued', lockedUntil: null, lastError: errorText(err), runAt: new Date(now.getTime() + backoffMs(job.attempts)) })
    .where(eq(jobs.id, job.id));
  return 'retry';
}

export type Handlers = Partial<Record<JobKind, (payload: Record<string, unknown>, job: Job) => Promise<void>>>;

/** Runs due jobs until none are left or the time budget is used up. */
export async function runDueJobs(handlers: Handlers, opts: { budgetMs?: number; batch?: number } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? 50_000);
  const result = { done: 0, retried: 0, failed: 0 };
  while (Date.now() < deadline) {
    const batch = await claim(opts.batch ?? 5);
    if (!batch.length) break;
    await Promise.all(
      batch.map(async (job) => {
        const handler = handlers[job.kind as JobKind];
        try {
          // Not permanent: during a deploy an older version can claim a job a newer one queued.
          if (!handler) throw new Error(`This version has no handler for ${job.kind}`);
          await handler(job.payload, job);
          await complete(job.id);
          result.done++;
        } catch (err) {
          console.error(`Job ${job.kind} ${job.id} failed:`, errorText(err));
          const outcome = await failJob(job, err);
          if (outcome === 'retry') result.retried++;
          else result.failed++;
        }
      }),
    );
  }
  return result;
}

/** Finished jobs are removed after 14 days, failed ones after 60. */
export async function pruneJobs(now = new Date()): Promise<number> {
  const db = await getDb();
  const removed = await rows<{ id: string }>(
    db,
    sql`
    delete from jobs
    where (status = 'done' and finished_at < ${new Date(now.getTime() - 14 * 86_400_000).toISOString()})
       or (status = 'failed' and finished_at < ${new Date(now.getTime() - 60 * 86_400_000).toISOString()})
    returning id`,
  );
  return removed.length;
}
