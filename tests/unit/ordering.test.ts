import { describe, expect, it } from 'vitest';
import { canOrder, orderingState } from '@/lib/ordering';

const show = {
  status: 'live' as const,
  orderingOpensAt: new Date('2027-01-10T09:00:00Z'),
  earlyBirdEndsAt: new Date('2027-03-01T00:00:00Z'),
  latePricesFrom: new Date('2027-04-15T00:00:00Z'),
  orderingClosesAt: new Date('2027-05-01T17:00:00Z'),
};

describe('the ordering window', () => {
  it('follows the dates', () => {
    expect(orderingState(show, new Date('2027-01-01'))).toBe('not_open');
    expect(orderingState(show, new Date('2027-02-01'))).toBe('early_bird');
    expect(orderingState(show, new Date('2027-03-01T00:00:00Z'))).toBe('standard');
    expect(orderingState(show, new Date('2027-04-20'))).toBe('late');
    expect(orderingState(show, new Date('2027-05-01T17:00:00Z'))).toBe('closed');
  });

  it('is shut whenever the show is not live', () => {
    expect(orderingState({ ...show, status: 'draft' }, new Date('2027-02-01'))).toBe('not_open');
    expect(orderingState({ ...show, status: 'closed' }, new Date('2027-02-01'))).toBe('closed');
  });

  it('is open with no dates set once live', () => {
    const open = { status: 'live' as const, orderingOpensAt: null, earlyBirdEndsAt: null, latePricesFrom: null, orderingClosesAt: null };
    expect(canOrder(orderingState(open))).toBe(true);
  });
});
