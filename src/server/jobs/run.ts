import 'server-only';
import { enqueue, pruneJobs, runDueJobs, type Handlers } from './queue';

/** Every job handler, in one place. Modules load lazily so a job only pulls in what it needs. */
const handlers: Handlers = {
  send_email: async (p) => {
    const { deliverOutboxEmail } = await import('../email/send');
    await deliverOutboxEmail(String(p.outboxId));
  },
  purge_expired: async () => {
    const { purgeExpired } = await import('../services/housekeeping');
    await purgeExpired();
  },
  order_paid: async (p) => {
    const { afterSupplierOrdersPaid } = await import('../services/invoices');
    await afterSupplierOrdersPaid(String(p.orderId), (p.supplierOrderIds as string[]) ?? []);
  },
  refund_succeeded: async (p) => {
    const { afterRefund } = await import('../services/refunds');
    await afterRefund(String(p.refundId));
  },
  release_holds: async () => {
    const { releaseExpiredHolds } = await import('../services/orders');
    await releaseExpiredHolds();
  },
  document_reminders: async () => {
    const { sendDocumentReminders } = await import('../services/documents');
    await sendDocumentReminders();
  },
};

export function runJobsNow(opts: { budgetMs?: number } = {}) {
  return runDueJobs(handlers, opts);
}

/**
 * Starts on queued jobs straight after the current response is sent, so an email goes in seconds
 * rather than at the next sweep. Outside a request (scripts, tests) the jobs run now.
 */
export async function kickJobs(): Promise<void> {
  try {
    const { after } = await import('next/server');
    after(async () => {
      try {
        await runJobsNow({ budgetMs: 25_000 });
      } catch (err) {
        console.error('Running jobs after the response failed', err instanceof Error ? err.message : err);
      }
    });
  } catch {
    await runJobsNow({ budgetMs: 25_000 });
  }
}

/** Vercel Cron, every ten minutes: anything left on the queue, and once a day the tidy-up and document reminders. */
export async function sweep(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  await enqueue('purge_expired', {}, { dedupeKey: `purge:${day}`, once: true, maxAttempts: 2 });
  // From 8am UTC, so reminders arrive in working hours.
  if (now.getUTCHours() >= 8) await enqueue('document_reminders', {}, { dedupeKey: `document-reminders:${day}`, once: true, maxAttempts: 3 });
  // Every sweep: unpaid orders left for a day give up their place.
  await enqueue('release_holds', {}, { dedupeKey: 'release-holds', maxAttempts: 1 });
  const ran = await runJobsNow({ budgetMs: 50_000 });
  const pruned = await pruneJobs(now);
  return { ...ran, pruned };
}
