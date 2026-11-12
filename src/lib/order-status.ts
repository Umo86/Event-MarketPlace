/** Words and colours for order and supplier order statuses (shared by every page). */
export const ORDER_STATUS_LABEL = {
  pending_payment: 'Not paid yet',
  paid: 'Paid',
  part_paid: 'Partly paid',
  payment_needed: 'Payment needed',
  cancelled: 'Cancelled',
} as const;

export const ORDER_STATUS_COLOUR: Record<keyof typeof ORDER_STATUS_LABEL, string> = { pending_payment: 'gray', paid: 'green', part_paid: 'yellow', payment_needed: 'red', cancelled: 'gray' };

export const PART_STATUS_LABEL = {
  pending: 'Not paid yet',
  paid: 'Paid',
  payment_needed: 'Payment needed',
  cancelled: 'Cancelled',
  part_refunded: 'Partly refunded',
  refunded: 'Refunded',
} as const;

export const PART_STATUS_COLOUR: Record<keyof typeof PART_STATUS_LABEL, string> = { pending: 'gray', paid: 'green', payment_needed: 'red', cancelled: 'gray', part_refunded: 'grape', refunded: 'grape' };
