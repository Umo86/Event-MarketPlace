import { requireActor } from '@/server/auth/current';
import { getShow } from '@/server/services/shows';
import { showOrderRows } from '@/server/services/reports';
import { csvResponse, ordersCsv } from '@/server/services/exports';

export async function GET(_req: Request, ctx: RouteContext<'/admin/shows/[showId]/orders/export'>) {
  const { showId } = await ctx.params;
  const { actor } = await requireActor('orders.view', { showId });
  const show = await getShow(showId);
  const rows = await showOrderRows(actor, showId);
  return csvResponse(await ordersCsv(rows, { withCommission: true }), `${show?.slug ?? 'show'}-orders.csv`);
}
