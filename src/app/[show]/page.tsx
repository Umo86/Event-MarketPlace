import type { Metadata } from 'next';
import { Anchor, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { requireActor } from '@/server/auth/current';
import { asExhibitor } from '@/server/authz';
import { myStands } from '@/server/services/storefront-auth';
import { fileUrl } from '@/server/services/files';
import { canOrder, orderingState, type OrderingState } from '@/lib/ordering';
import { dateTime } from '@/lib/format';
import { loadStorefront } from './load';
import styles from './storefront.module.css';

export const metadata: Metadata = { title: 'Home' };

const STATE_TEXT: Record<OrderingState, string> = {
  not_open: 'Ordering hasn’t opened yet.',
  early_bird: 'Ordering is open, at early-bird prices.',
  standard: 'Ordering is open.',
  late: 'Ordering is open. Late prices now apply.',
  closed: 'Ordering has closed.',
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper withBorder radius="md" p="lg" style={{ borderColor: 'var(--em-line)' }}>
      <Title order={2} fz="lg" mb="sm">
        {title}
      </Title>
      {children}
    </Paper>
  );
}

export default async function StorefrontHome({ params }: PageProps<'/[show]'>) {
  const { show: slug } = await params;
  const { show, branding } = await loadStorefront(slug);
  const { actor } = await requireActor('storefront.browse', { showId: show.id });
  const stands = await myStands(asExhibitor(actor));
  const state = orderingState(show);
  const tz = show.timezone;
  const banner = fileUrl(branding.bannerFileId);
  const deadlines: [string, Date | null][] = [
    ['Ordering opens', show.orderingOpensAt],
    ['Early-bird prices end', show.earlyBirdEndsAt],
    ['Late prices start', show.latePricesFrom],
    ['Ordering closes', show.orderingClosesAt],
  ];
  const contactName = stands.find((s) => s.contactName)?.contactName;
  return (
    <Stack gap="lg">
      {banner ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner} alt="" className={styles.banner} />
      ) : null}
      <div>
        <h1 className="page-title" style={{ fontSize: 32 }}>
          {contactName ? `Welcome, ${contactName.split(' ')[0]}` : 'Welcome'}
        </h1>
        <Text c="dimmed" mt={6}>
          Order services for your stand at {show.name}, from the show’s approved suppliers.
        </Text>
      </div>
      <Paper radius="md" p="md" style={{ background: 'var(--brand-main-tint)', border: '1px solid var(--em-line)' }}>
        <Group gap="sm">
          {state === 'early_bird' ? <span className={styles.highlight}>Early-bird prices</span> : null}
          <Text fw={600}>{STATE_TEXT[state]}</Text>
          {!canOrder(state) && show.helpEmail ? (
            <Text fz="sm">
              Need something? Contact the show team at{' '}
              <Anchor href={`mailto:${show.helpEmail}`} className="text-link">
                {show.helpEmail}
              </Anchor>
              {show.helpPhone ? ` or ${show.helpPhone}` : ''}.
            </Text>
          ) : null}
        </Group>
      </Paper>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card title={stands.length > 1 ? 'Your stands' : 'Your stand'}>
          <Stack gap="xs">
            {stands.map((s) => (
              <div key={s.standId}>
                <Text fw={600}>
                  Stand {s.number} · {s.company}
                </Text>
                <Text fz="sm" c="dimmed">
                  {[s.hall, s.standType].filter(Boolean).join(' · ') || 'Hall and stand type to be confirmed'}
                </Text>
              </div>
            ))}
            {stands.length > 1 ? (
              <Text fz="sm" c="dimmed">
                Each order is for one stand. You’ll choose which when you order.
              </Text>
            ) : null}
          </Stack>
        </Card>
        <Card title="Deadlines">
          <Stack gap={6}>
            {deadlines
              .filter(([, at]) => at)
              .map(([label, at]) => (
                <Group key={label} justify="space-between">
                  <Text fz="sm">{label}</Text>
                  <Text fz="sm" fw={600}>
                    {dateTime(at, tz)}
                  </Text>
                </Group>
              ))}
            {deadlines.every(([, at]) => !at) ? (
              <Text fz="sm" c="dimmed">
                The show team will confirm the ordering dates soon.
              </Text>
            ) : null}
          </Stack>
        </Card>
      </SimpleGrid>
      <Card title="Services">
        <Text fz="sm" c="dimmed">
          Services for your stand will appear here once the show’s suppliers have added them: furniture, carpet, electrics, nameboards, cleaning and more.
        </Text>
      </Card>
      <Card title="Need help?">
        <Stack gap={4}>
          {show.helpEmail ? (
            <Text fz="sm">
              Email{' '}
              <Anchor href={`mailto:${show.helpEmail}`} className="text-link">
                {show.helpEmail}
              </Anchor>
            </Text>
          ) : null}
          {show.helpPhone ? <Text fz="sm">Call {show.helpPhone}</Text> : null}
          {show.billieUrl ? (
            <Text fz="sm">
              <Anchor href={show.billieUrl} target="_blank" rel="noopener" className="text-link">
                Ask the show’s chat assistant
              </Anchor>
            </Text>
          ) : null}
          {!show.helpEmail && !show.helpPhone && !show.billieUrl ? (
            <Text fz="sm" c="dimmed">
              Contact the show team through the exhibitor manual.
            </Text>
          ) : null}
        </Stack>
      </Card>
    </Stack>
  );
}
