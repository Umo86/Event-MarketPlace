import type { Metadata } from 'next';
import { Stack } from '@mantine/core';
import { Panel } from '@/components/ui/panel';
import { can } from '@/server/authz';
import { listExhibitors } from '@/server/services/exhibitors';
import { env } from '@/server/env';
import { dateTime } from '@/lib/format';
import { loadShow } from '../load';
import { ExhibitorTable } from './exhibitor-table';
import { UploadWizard } from './upload-wizard';
import { ConnectionPanel } from './connection-panel';

export const metadata: Metadata = { title: 'Exhibitors' };

export default async function ExhibitorsPage({ params }: PageProps<'/admin/shows/[showId]/exhibitors'>) {
  const { showId } = await params;
  const { actor, show } = await loadShow(showId, 'exhibitors.view');
  const [rows, canManage, canKey] = await Promise.all([listExhibitors(actor, show.id), can(actor, 'exhibitors.manage', { showId }), can(actor, 'show.connection.manage', { showId })]);
  return (
    <Stack gap="lg">
      <Panel title="Exhibitor list" description="Exhibitors sign in to the storefront with an email on this list. One row per contact per stand.">
        <ExhibitorTable rows={rows.map((r) => ({ ...r, hall: r.hall ?? '', standType: r.standType ?? '', phone: r.phone ?? '' }))} />
      </Panel>
      {canManage ? (
        <Panel title="Upload a list" description="Excel (.xlsx) or CSV. Columns are found by their headings: Company, Stand, Hall, Stand type, Contact name, Email, Phone. You’ll see what changes before anything is saved.">
          <UploadWizard showId={show.id} />
        </Panel>
      ) : null}
      {canKey ? (
        <Panel title="Connect BluePrint" description="BluePrint can send this list for you and sign exhibitors straight in to the storefront. It needs this show’s key.">
          <ConnectionPanel
            showId={show.id}
            slug={show.slug}
            appUrl={env().APP_URL}
            keyId={show.connectionKeyId}
            createdAt={show.connectionKeyCreatedAt ? dateTime(show.connectionKeyCreatedAt, show.timezone) : null}
            lastSync={show.lastListSyncAt ? dateTime(show.lastListSyncAt, show.timezone) : null}
            lastSignIn={show.lastLinkSignInAt ? dateTime(show.lastLinkSignInAt, show.timezone) : null}
          />
        </Panel>
      ) : null}
    </Stack>
  );
}
