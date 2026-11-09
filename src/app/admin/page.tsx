import type { Metadata } from 'next';
import { LinkButton, LinkAnchor } from '@/components/ui/links';
import { Badge, Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { requireActor } from '@/server/auth/current';
import { can } from '@/server/authz';
import { listShowsFor } from '@/server/services/shows';
import { STATUS_COLOUR, STATUS_LABEL } from '@/lib/show-status';
import { dateShort } from '@/lib/format';

export const metadata: Metadata = { title: 'Shows' };

export default async function ShowsPage() {
  const { actor } = await requireActor('shows.list');
  const shows = await listShowsFor(actor);
  const canCreate = await can(actor, 'shows.create');
  return (
    <>
      <PageHeader
        title="Shows"
        description="Each show has its own branded storefront, exhibitor list and suppliers."
        actions={
          canCreate ? (
            <LinkButton href="/admin/shows/new" leftSection={<IconPlus size={16} />}>
              New show
            </LinkButton>
          ) : null
        }
      />
      {shows.length ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {shows.map((s) => (
            <Paper key={s.id} withBorder radius="md" p="lg" style={{ borderColor: 'var(--em-line)' }}>
              <Stack gap={6}>
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <LinkAnchor href={`/admin/shows/${s.id}`} fw={650} c="var(--em-ink)">
                    {s.name}
                  </LinkAnchor>
                  <Badge color={STATUS_COLOUR[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                </Group>
                <Text fz="sm" c="dimmed">
                  /{s.slug}
                  {s.venue ? ` · ${s.venue}` : ''}
                </Text>
                <Text fz="sm" c="dimmed">
                  {s.orderingClosesAt ? `Ordering closes ${dateShort(s.orderingClosesAt, s.timezone)}` : 'Ordering dates not set yet'}
                </Text>
              </Stack>
            </Paper>
          ))}
        </SimpleGrid>
      ) : (
        <Paper withBorder radius="md" p="xl" style={{ borderColor: 'var(--em-line)' }}>
          <Text fw={600}>No shows yet</Text>
          <Text fz="sm" c="dimmed" mt={4}>
            {canCreate ? 'Create the first show to set up its storefront.' : 'When a super admin adds you to a show’s team, it appears here.'}
          </Text>
        </Paper>
      )}
    </>
  );
}
