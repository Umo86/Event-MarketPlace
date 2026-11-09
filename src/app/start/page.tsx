import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Text } from '@mantine/core';
import { AuthCard } from '@/components/auth-card';
import { requireSignedIn } from '@/server/auth/current';
import { staffShowIds, supplierIdsFor } from '@/server/authz';

export const metadata: Metadata = { title: 'Welcome' };

/** Where signing in leads: Media10 staff to their shows, suppliers to their panel. */
export default async function StartPage() {
  const actor = await requireSignedIn();
  const shows = await staffShowIds(actor);
  if (shows === null || shows.length) redirect('/admin');
  const suppliers = await supplierIdsFor(actor);
  if (suppliers.length === 1) redirect(`/supplier/${suppliers[0]}`);
  if (suppliers.length > 1) redirect('/supplier');
  return (
    <AuthCard title="Nothing to show yet">
      <Text fz="sm">Your account isn’t linked to a show or a supplier yet. Ask the person at Media10 who set it up.</Text>
    </AuthCard>
  );
}
