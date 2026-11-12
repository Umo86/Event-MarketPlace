import 'server-only';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { getDb, type DbLike } from '../db/client';
import { orderLines, orders, supplierOrders } from '../db/schema';

/**
 * How many of each product are taken: paid for, or held for an order still being paid for (an hour
 * from checkout). Fully refunded and cancelled orders give their stock back.
 */
export async function heldQuantities(productIds: string[], opts: { now?: Date; db?: DbLike; excludeOrderId?: string } = {}) {
  if (!productIds.length) return new Map<string, number>();
  const db = opts.db ?? (await getDb());
  const now = opts.now ?? new Date();
  const rows = await db
    .select({ productId: orderLines.productId, n: sql<number>`coalesce(sum(${orderLines.quantity}), 0)::int` })
    .from(orderLines)
    .innerJoin(supplierOrders, eq(supplierOrders.id, orderLines.supplierOrderId))
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(
      and(
        inArray(orderLines.productId, productIds),
        opts.excludeOrderId ? sql`${orders.id} <> ${opts.excludeOrderId}` : undefined,
        or(inArray(supplierOrders.status, ['paid', 'part_refunded']), and(inArray(supplierOrders.status, ['pending', 'payment_needed']), gt(orders.holdUntil, now))),
      ),
    )
    .groupBy(orderLines.productId);
  return new Map(rows.map((r) => [r.productId!, Number(r.n)]));
}
