/** Supplier documents: what they're called and whether they're still in date (pure, shared by every page). */
import { toLocalDateString } from './dates';

export const DOCUMENT_KIND_LABEL = {
  public_liability: 'Public liability insurance',
  employers_liability: 'Employer’s liability insurance',
  product_liability: 'Product liability insurance',
  risk_assessment: 'Risk assessment',
  method_statement: 'Method statement',
  other: 'Other document',
} as const;

export type DocumentKindName = keyof typeof DOCUMENT_KIND_LABEL;

/** Insurance must have an expiry date; other documents may. */
export const EXPIRY_REQUIRED: ReadonlySet<DocumentKindName> = new Set(['public_liability', 'employers_liability', 'product_liability']);

/** How many days before expiry the reminder goes, and the warning starts. */
export const REMINDER_DAYS = 30;

export type DocumentState = 'valid' | 'expiring' | 'expired' | 'no_expiry' | 'replaced';

/** "YYYY-MM-DD" today in UK time. */
export function todayInLondon(now = new Date()): string {
  return toLocalDateString(now)!;
}

/** Whole days from one calendar date to another ("2027-01-01" to "2027-01-31" is 30). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The expiry date is the last valid day. */
export function documentState(expiresOn: string | null, today: string, replaced = false): DocumentState {
  if (replaced) return 'replaced';
  if (!expiresOn) return 'no_expiry';
  const left = daysBetween(today, expiresOn);
  if (left < 0) return 'expired';
  if (left <= REMINDER_DAYS) return 'expiring';
  return 'valid';
}

export const DOCUMENT_STATE_LABEL: Record<DocumentState, string> = {
  valid: 'In date',
  expiring: 'Expires soon',
  expired: 'Expired',
  no_expiry: 'No expiry date',
  replaced: 'Replaced by a newer one',
};

export const DOCUMENT_STATE_COLOUR: Record<DocumentState, string> = { valid: 'green', expiring: 'yellow', expired: 'red', no_expiry: 'gray', replaced: 'gray' };

/** "Expires in 12 days", "Expires today", "Expired 3 days ago". */
export function expiryPhrase(expiresOn: string | null, today: string): string {
  if (!expiresOn) return 'No expiry date';
  const left = daysBetween(today, expiresOn);
  if (left === 0) return 'Expires today';
  if (left === 1) return 'Expires tomorrow';
  if (left > 1) return `Expires in ${left} days`;
  if (left === -1) return 'Expired yesterday';
  return `Expired ${-left} days ago`;
}
