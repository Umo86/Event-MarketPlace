import { requireActor } from '@/server/auth/current';
import { supplierOrderRows } from '@/server/services/reports';
import { csvResponse, ordersCsv } from '@/server/services/exports';

export async function GET(_req: Request, ctx: RouteContext<'/supplier/[supplierId]/orders/export'>) {
  const { supplierId } = await ctx.params;
  const { actor } = await requireActor('supplier.view', { supplierId });
  const rows = await supplierOrderRows(actor, supplierId);
  return csvResponse(await ordersCsv(rows, { withCommission: true }), `orders-${new Date().toISOString().slice(0, 10)}.csv`);
}
