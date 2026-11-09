import type { Metadata } from 'next';
import { Stack } from '@mantine/core';
import { Panel } from '@/components/ui/panel';
import { can } from '@/server/authz';
import { listTeam } from '@/server/services/shows';
import { dateShort } from '@/lib/format';
import { loadShow } from '../load';
import { TeamManager } from './team-manager';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage({ params }: PageProps<'/admin/shows/[showId]/team'>) {
  const { showId } = await params;
  const { actor, show } = await loadShow(showId);
  const [team, canManage] = await Promise.all([listTeam(actor, show.id), can(actor, 'show.team.manage', { showId })]);
  return (
    <Stack gap="lg">
      <Panel title="Show team" description="Show admins can do everything for this show. Team members can see it, plus the rights you give them. Refunds are a right of their own.">
        <TeamManager
          showId={show.id}
          me={actor.kind === 'user' ? actor.userId : ''}
          canManage={canManage}
          members={team.members.map((m) => ({ ...m, twoFactor: Boolean(m.twoFactor) }))}
          pending={team.pending.map((p) => ({ ...p, expires: dateShort(p.expiresAt) }))}
        />
      </Panel>
    </Stack>
  );
}
