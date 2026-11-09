import type { Metadata } from 'next';
import { Panel } from '@/components/ui/panel';
import { toLocalDateTimeString } from '@/lib/dates';
import { loadShow } from '../load';
import { SettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Show settings' };

const local = (d: Date | null, tz: string) => toLocalDateTimeString(d, tz)?.slice(0, 16).replace(' ', 'T') ?? '';

export default async function SettingsPage({ params }: PageProps<'/admin/shows/[showId]/settings'>) {
  const { showId } = await params;
  const { show } = await loadShow(showId, 'show.settings.edit');
  return (
    <Panel title="Settings" description="The show’s details, when exhibitors can order, and who they contact for help.">
      <SettingsForm
        initial={{
          showId: show.id,
          name: show.name,
          venue: show.venue ?? '',
          status: show.status,
          orderingOpensAt: local(show.orderingOpensAt, show.timezone),
          earlyBirdEndsAt: local(show.earlyBirdEndsAt, show.timezone),
          latePricesFrom: local(show.latePricesFrom, show.timezone),
          orderingClosesAt: local(show.orderingClosesAt, show.timezone),
          helpEmail: show.helpEmail ?? '',
          helpPhone: show.helpPhone ?? '',
          billieUrl: show.billieUrl ?? '',
        }}
      />
    </Panel>
  );
}
