'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction, type ActionResult } from '@/server/actions';
import { asUser } from '@/server/authz';
import { getDb } from '@/server/db/client';
import { supplierOrders } from '@/server/db/schema';
import { refundSupplierOrder } from '@/server/services/refunds';
import { eq } from 'drizzle-orm';

/**
 * Refunds from the supplier panel (`supplier.refund`) or by Media10 on the supplier's behalf
 * (`orders.refund`). The supplier order's own show and supplier are looked up, never taken from
 * the browser.
 */
const schema = z.object({
  supplierOrderId: z.string().uuid(),
  lineAmounts: z.record(z.string().uuid(), z.number().int().min(0)).default({}),
  amountPence: z.number().int().min(0).optional(),
  reason: z.string().max(300),
  via: z.enum(['supplier', 'show']),
});

async function owner(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { showId: '', supplierId: '' };
  const db = await getDb();
  const [row] = await db.select({ showId: supplierOrders.showId, supplierId: supplierOrders.supplierId }).from(supplierOrders).where(eq(supplierOrders.id, id)).limit(1);
  return row ?? { showId: '', supplierId: '' };
}

export async function refundAction(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  const via = parsed.success ? parsed.data.via : 'supplier';
  const where = parsed.success ? await owner(parsed.data.supplierOrderId) : { showId: '', supplierId: '' };
  return runAction({
    action: via === 'supplier' ? 'supplier.refund' : 'orders.refund',
    schema,
    input,
    target: () => (via === 'supplier' ? { supplierId: where.supplierId } : { showId: where.showId }),
    work: async (actor, d) => {
      await refundSupplierOrder(asUser(actor), d, d.via);
      revalidatePath('/', 'layout');
    },
    message: 'Refunded. The exhibitor has been emailed a credit note.',
  });
}
