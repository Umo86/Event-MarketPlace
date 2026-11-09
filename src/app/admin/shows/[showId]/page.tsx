import type { Metadata } from 'next';
import { LinkAnchor } from '@/components/ui/links';
import { Group, List, ListItem, SimpleGrid, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconCheck, IconCircleDashed } from '@tabler/icons-react';
import { Panel } from '@/components/ui/panel';
import { can } from '@/server/authz';
import { exhibitorCounts } from '@/server/services/exhibitors';
import { dateTime } from '@/lib/format';
import { STATUS_HELP } from '@/lib/show-status';
import { loadShow } from './load';

export const metadata: Metadata = { title: 'Show overview' };

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <ListItem
      icon={
        <ThemeIcon size={22} radius="xl" color={done ? 'green' : 'gray'} variant={done ? 'filled' : 'light'} aria-label={done ? 'Done' : 'To do'}>
          {done ? <IconCheck size={14} /> : <IconCircleDashed size={14} />}
        </ThemeIcon>
      }
    >
      {children}
    </ListItem>
  );
}

export default async function ShowOverview({ params }: PageProps<'/admin/shows/[showId]'>) {
  const { showId } = await params;
  const { actor, show } = await loadShow(showId);
  const counts = await exhibitorCounts(actor, show.id);
  const admin = await can(actor, 'show.settings.edit', { showId });
  const base = `/admin/shows/${show.id}`;
  const branded = Boolean(show.branding.primaryColor || show.branding.logoFileId || show.branding.marketplaceName);
  const dated = Boolean(show.orderingOpensAt && show.orderingClosesAt);
  const tz = show.timezone;
  const dates: [string, Date | null][] = [
    ['Ordering opens', show.orderingOpensAt],
    ['Early-bird prices end', show.earlyBirdEndsAt],
    ['Late prices start', show.latePricesFrom],
    ['Ordering closes', show.orderingClosesAt],
  ];
  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Panel title="Getting ready" description={STATUS_HELP[show.status]}>
          <List spacing="sm" center>
            <Step done={branded}>
              {admin ? (
                <LinkAnchor href={`${base}/branding`} className="text-link">
                  Set the storefront’s branding
                </LinkAnchor>
              ) : (
                'Storefront branding set'
              )}
            </Step>
            <Step done={dated}>
              {admin ? (
                <LinkAnchor href={`${base}/settings`} className="text-link">
                  Set the ordering dates and help contacts
                </LinkAnchor>
              ) : (
                'Ordering dates set'
              )}
            </Step>
            <Step done={counts.contacts > 0}>
              <LinkAnchor href={`${base}/exhibitors`} className="text-link">
                Add the exhibitor list
              </LinkAnchor>{' '}
              {counts.contacts ? `(${counts.contacts.toLocaleString('en-GB')} contacts on ${counts.stands.toLocaleString('en-GB')} stands)` : ''}
            </Step>
            <Step done={Boolean(show.connectionKeyId)}>Connect BluePrint (optional), on the Exhibitors page</Step>
            <Step done={show.status === 'live'}>{admin ? 'Make the show live, in Settings' : 'Show made live'}</Step>
            <Step done={false}>Add suppliers and services (coming in the next part of the build)</Step>
          </List>
        </Panel>
        <Panel title="Ordering dates" description="In UK time. Prices and the storefront follow these.">
          <Stack gap={6}>
            {dates.map(([label, at]) => (
              <Group key={label} justify="space-between">
                <Text fz="sm">{label}</Text>
                <Text fz="sm" fw={600}>
                  {at ? dateTime(at, tz) : 'Not set'}
                </Text>
              </Group>
            ))}
          </Stack>
          <Text fz="sm" c="dimmed">
            Help for exhibitors: {show.helpEmail ?? 'no email set'}
            {show.helpPhone ? ` · ${show.helpPhone}` : ''}
          </Text>
        </Panel>
      </SimpleGrid>
    </Stack>
  );
}
