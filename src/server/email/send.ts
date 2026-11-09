import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, type DbLike } from '../db/client';
import { emailOutbox, type EmailCategory } from '../db/schema';
import { env } from '../env';
import { EMAIL_OFF_REASON, emailProvider } from './provider';
import { enqueue } from '../jobs/queue';
import { PLATFORM_NAME } from '@/lib/branding';

export type SendEmailInput = {
  to: string;
  showId?: string | null;
  templateKey: string;
  category: EmailCategory;
  subject: string;
  html: string;
  text: string;
  /** The sender name, e.g. "UKCW London Marketplace". The address is always the one verified domain. */
  senderName?: string | null;
  replyTo?: string | null;
};

const PLAIN_ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function oneLine(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** "UKCW London Marketplace <marketplace@mail.media10.co.uk>", with the name made safe for a header. */
export function fromHeader(senderName: string | null | undefined): string {
  const name = oneLine(senderName ?? '')
    .replace(/[<>"\\]/g, '')
    .slice(0, 80) || PLATFORM_NAME;
  return `"${name}" <${env().EMAIL_FROM_ADDRESS}>`;
}

/**
 * Sign-in codes and personal links are for the recipient only. Once an email has gone, the copy
 * kept has them hidden, so nobody can read them back from the log.
 */
export function hideSecrets(value: string, category: string): string {
  let out = value.replace(/(\/invite\/)[A-Za-z0-9_-]{16,}/g, '$1[hidden]');
  if (category === 'security') out = out.replace(/\b\d{6}\b/g, '••••••');
  return out;
}

/**
 * Records the email in the outbox and queues it for sending (CLAUDE.md: slow work goes on the job
 * queue). Pass `tx` to queue it with the change that caused it; then call kickJobs() once the
 * transaction has finished.
 */
export async function queueEmail(input: SendEmailInput, opts: { tx?: DbLike } = {}): Promise<string> {
  const db = opts.tx ?? (await getDb());
  const to = input.to.trim().toLowerCase();
  const replyTo = input.replyTo && PLAIN_ADDRESS.test(input.replyTo.trim()) ? input.replyTo.trim() : null;
  const off = emailProvider().name === 'off';
  // Nothing is ever sent to a demo address (ending .test) outside a developer's computer.
  const demoAddress = /\.test$/.test(to) && emailProvider().name !== 'outbox';
  const notSent = off ? EMAIL_OFF_REASON : demoAddress ? 'Not sent: a demo address (ending .test)' : null;
  const keep = (v: string) => (notSent ? hideSecrets(v, input.category) : v);
  const [row] = await db
    .insert(emailOutbox)
    .values({
      showId: input.showId ?? null,
      toEmail: to,
      templateKey: input.templateKey,
      category: input.category,
      fromAddress: fromHeader(input.senderName),
      replyTo,
      subject: keep(oneLine(input.subject).slice(0, 300)),
      html: keep(input.html),
      text: keep(input.text),
      status: notSent ? 'suppressed' : 'queued',
      error: notSent,
    })
    .returning({ id: emailOutbox.id });
  if (!notSent) await enqueue('send_email', { outboxId: row.id }, { tx: db, dedupeKey: `email:${row.id}`, maxAttempts: 6 });
  return row.id;
}

/** Sends one queued email (the send_email job). Safe to run twice: only one run sends it. */
export async function deliverOutboxEmail(outboxId: string): Promise<'sent' | 'skipped'> {
  const db = await getDb();
  const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, outboxId)).limit(1);
  if (!mail || (mail.status !== 'queued' && mail.status !== 'failed')) return 'skipped';
  const [claimed] = await db
    .update(emailOutbox)
    .set({ attempts: mail.attempts + 1 })
    .where(and(eq(emailOutbox.id, outboxId), eq(emailOutbox.attempts, mail.attempts), inArray(emailOutbox.status, ['queued', 'failed'])))
    .returning({ id: emailOutbox.id });
  if (!claimed) return 'skipped';
  try {
    const result = await emailProvider().send({
      from: mail.fromAddress,
      to: mail.toEmail,
      replyTo: mail.replyTo,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    const real = emailProvider().name !== 'outbox';
    await db
      .update(emailOutbox)
      .set({
        status: 'sent',
        providerMessageId: result.id,
        sentAt: new Date(),
        error: null,
        // With real delivery the stored copy is only a record, so codes and links come out of it.
        // (Locally the stored copy is the mailbox, so it is kept whole.)
        ...(real ? { subject: hideSecrets(mail.subject, mail.category), html: hideSecrets(mail.html, mail.category), text: hideSecrets(mail.text, mail.category) } : {}),
      })
      .where(eq(emailOutbox.id, outboxId));
    return 'sent';
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : 'Send failed';
    await db.update(emailOutbox).set({ status: 'failed', error: message }).where(eq(emailOutbox.id, outboxId));
    // Thrown so the job queue tries again later.
    throw err;
  }
}
