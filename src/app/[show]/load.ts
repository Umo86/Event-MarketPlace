import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { brandingFor, getShowBySlug } from '@/server/services/shows';

/** The show behind a storefront address, with its branding. Archived or unknown shows are "not found". */
export const loadStorefront = cache(async (slug: string) => {
  const show = await getShowBySlug(slug);
  if (!show) notFound();
  return { show, branding: await brandingFor(show) };
});
