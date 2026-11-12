/**
 * Money maths (pure, so the basket, the checkout, invoices and tests all agree). Whole pence only.
 * Prices are net of VAT; VAT is rounded once per line, half away from zero (docs/payments.md).
 */
import { orderingState, type OrderingDates } from './ordering';

export type CommissionRule = { type: 'percent' | 'fixed'; value: number };
export type CommissionSetting = { type: 'percent' | 'fixed' | null; value: number | null } | null | undefined;
export type PriceBand = 'early' | 'standard' | 'late';

/** Round half away from zero: 2.5 → 3, −2.5 → −3. */
export function roundPence(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

export function vatOn(netPence: number, rateBps: number): number {
  return roundPence((netPence * rateBps) / 10_000);
}

/** The price that applies now, from the show's dates: early-bird, standard or late. */
export function priceFor(
  p: { pricePence: number; earlyPricePence: number | null; latePricePence: number | null },
  show: OrderingDates,
  now = new Date(),
): { unitPence: number; band: PriceBand } {
  const state = orderingState(show, now);
  if (state === 'early_bird' && p.earlyPricePence !== null) return { unitPence: p.earlyPricePence, band: 'early' };
  if (state === 'late' && p.latePricePence !== null) return { unitPence: p.latePricePence, band: 'late' };
  return { unitPence: p.pricePence, band: 'standard' };
}

/** The first commission that is set wins: product, then category, then supplier, then show, then platform. */
export function resolveCommission(...rules: CommissionSetting[]): CommissionRule {
  for (const r of rules) {
    if (r && r.type && r.value !== null && r.value !== undefined) return { type: r.type, value: r.value };
  }
  return { type: 'percent', value: 0 };
}

/** Commission on a line's net amount: a percentage (basis points) or a fixed amount per line, never more than the net. */
export function commissionFor(netPence: number, rule: CommissionRule): number {
  const raw = rule.type === 'percent' ? roundPence((netPence * rule.value) / 10_000) : rule.value;
  return Math.max(0, Math.min(netPence, raw));
}

export type LineInput = { unitPence: number; quantity: number; vatRateBps: number; commission: CommissionRule; organiser: boolean };
export type PricedLine = { netPence: number; vatPence: number; totalPence: number; commissionPence: number };

/** One order line. Media10's own services carry no commission: Media10 is the seller. */
export function priceLine(l: LineInput): PricedLine {
  const netPence = l.unitPence * l.quantity;
  const vatPence = vatOn(netPence, l.vatRateBps);
  const commissionPence = l.organiser ? 0 : commissionFor(netPence, l.commission);
  return { netPence, vatPence, totalPence: netPence + vatPence, commissionPence };
}

export function sumLines(lines: PricedLine[]) {
  return lines.reduce((a, l) => ({ netPence: a.netPence + l.netPence, vatPence: a.vatPence + l.vatPence, totalPence: a.totalPence + l.totalPence, commissionPence: a.commissionPence + l.commissionPence }), {
    netPence: 0,
    vatPence: 0,
    totalPence: 0,
    commissionPence: 0,
  });
}

/** Splits an amount across parts in proportion to their weights, so the parts always add up exactly. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || !total) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((r) => Math.floor(r));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    out[i] += 1;
    rest -= 1;
  }
  return out;
}

/** "£12.50" ⇄ 1250. Accepts "12", "12.5", "12.50", "£1,250.00". Null when it isn't a price. */
export function parsePounds(value: string): number | null {
  const v = value.replace(/[£,\s]/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(v)) return null;
  const [pounds, pence = ''] = v.split('.');
  return Number(pounds) * 100 + Number(pence.padEnd(2, '0'));
}

export function poundsInput(pence: number | null | undefined): string {
  if (pence === null || pence === undefined) return '';
  return (pence / 100).toFixed(2);
}
