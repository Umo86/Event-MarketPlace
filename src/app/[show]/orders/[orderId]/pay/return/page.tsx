import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireActor } from '@/server/auth/current';
import { FinishAfterRedirect } from '@/components/storefront/payment-form';
import { loadStorefront } from '../../../../load';

export const metadata: Metadata = { title: 'Finishing payment' };

/** Where the bank's security check sends people back to. */
export default async function PayReturnPage({ params, searchParams }: PageProps<'/[show]/orders/[orderId]/pay/return'>) {
  const { show: slug, orderId } = await params;
  const sp = await searchParams;
  const { show } = await loadStorefront(slug);
  await requireActor('storefront.order', { showId: show.id });
  const si = typeof sp.setup_intent === 'string' && /^seti_[A-Za-z0-9]{6,80}$/.test(sp.setup_intent) ? sp.setup_intent : null;
  if (!si) redirect(`/${slug}/orders/${orderId}`);
  return <FinishAfterRedirect slug={slug} orderId={orderId} setupIntentId={si} />;
}
