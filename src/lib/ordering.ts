/**
 * Where a show is in its ordering window, from its dates (pure, so the storefront and tests agree).
 * The price that applies when an order is placed follows the same dates (phase 2).
 */
export type OrderingState = 'not_open' | 'early_bird' | 'standard' | 'late' | 'closed';

export type OrderingDates = {
  status: 'draft' | 'live' | 'closed' | 'archived';
  orderingOpensAt: Date | null;
  earlyBirdEndsAt: Date | null;
  latePricesFrom: Date | null;
  orderingClosesAt: Date | null;
};

export function orderingState(show: OrderingDates, now = new Date()): OrderingState {
  if (show.status !== 'live') return show.status === 'draft' ? 'not_open' : 'closed';
  const t = now.getTime();
  if (show.orderingOpensAt && t < show.orderingOpensAt.getTime()) return 'not_open';
  if (show.orderingClosesAt && t >= show.orderingClosesAt.getTime()) return 'closed';
  if (show.latePricesFrom && t >= show.latePricesFrom.getTime()) return 'late';
  if (show.earlyBirdEndsAt && t < show.earlyBirdEndsAt.getTime()) return 'early_bird';
  return 'standard';
}

export function canOrder(state: OrderingState) {
  return state === 'early_bird' || state === 'standard' || state === 'late';
}
