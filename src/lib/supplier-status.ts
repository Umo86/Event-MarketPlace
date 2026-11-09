/** What a supplier's status is, worked out from the facts (pure, so admin and supplier pages agree). */
export type SupplierStatus = 'invited' | 'stripe_pending' | 'ready' | 'paused';

export function supplierStatus(s: { pausedAt: Date | null; stripeChargesEnabled: boolean; anyoneSignedIn: boolean }): SupplierStatus {
  if (s.pausedAt) return 'paused';
  if (s.stripeChargesEnabled) return 'ready';
  if (!s.anyoneSignedIn) return 'invited';
  return 'stripe_pending';
}

/** Only suppliers who are ready to sell show their services to exhibitors. */
export function canSell(status: SupplierStatus) {
  return status === 'ready';
}

export const SUPPLIER_STATUS_LABEL: Record<SupplierStatus, string> = {
  invited: 'Invited',
  stripe_pending: 'Stripe pending',
  ready: 'Ready to sell',
  paused: 'Paused',
};

export const SUPPLIER_STATUS_COLOUR: Record<SupplierStatus, string> = { invited: 'gray', stripe_pending: 'yellow', ready: 'green', paused: 'red' };

export const SUPPLIER_STATUS_HELP: Record<SupplierStatus, string> = {
  invited: 'Their login is made but nobody has signed in yet.',
  stripe_pending: 'Signed in, but not yet connected to Stripe, so they can’t take payments.',
  ready: 'Connected to Stripe and able to take payments. Their services can be shown to exhibitors.',
  paused: 'Their services are hidden and they take no new orders. Paid orders are not affected.',
};

/** An invoice prefix from the name: "Sparks Electrical Ltd" → "SE", "Carpetco" → "CAR". */
export function suggestPrefix(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/&/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter((w) => w && !['LTD', 'LIMITED', 'PLC', 'LLP', 'THE', 'AND', 'CO', 'UK'].includes(w));
  if (!words.length) return 'SUP';
  if (words.length === 1) return words[0].slice(0, 3).padEnd(2, 'X');
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('');
}
