import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { requireActor } from '@/server/auth/current';
import { brandingFor, getShow } from '@/server/services/shows';
import type { ActionName } from '@/server/authz';

/** The show a page is about, after checking the person may do `action` there. */
export const loadShow = cache(async (showId: string, action: ActionName = 'show.view') => {
  const grant = await requireActor(action, { showId });
  const show = await getShow(showId);
  if (!show) notFound();
  const branding = await brandingFor(show);
  return { ...grant, show, branding };
});
