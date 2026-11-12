import { Anchor, Badge, Group, Stack, Text } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { LinkTabs } from '@/components/ui/link-tabs';
import { can } from '@/server/authz';
import { fileUrl } from '@/server/services/files';
import { STATUS_COLOUR, STATUS_LABEL } from '@/lib/show-status';
import { loadShow } from './load';

/** Every show page: the show's own name and logo at the top, then its sections. */
export default async function ShowLayout({ children, params }: LayoutProps<'/admin/shows/[showId]'>) {
  const { showId } = await params;
  const { actor, show, branding } = await loadShow(showId);
  const base = `/admin/shows/${show.id}`;
  const [admin, exhibitors, ordersRight] = await Promise.all([can(actor, 'show.branding.edit', { showId }), can(actor, 'exhibitors.view', { showId }), can(actor, 'orders.view', { showId })]);
  const tabs = [
    { label: 'Overview', href: base, exact: true },
    ...(exhibitors ? [{ label: 'Exhibitors', href: `${base}/exhibitors` }] : []),
    { label: 'Categories', href: `${base}/categories` },
    { label: 'Products', href: `${base}/products` },
    ...(ordersRight ? [{ label: 'Orders', href: `${base}/orders` }] : []),
    ...(admin ? [{ label: 'Branding', href: `${base}/branding` }] : []),
    { label: 'Team', href: `${base}/team` },
    ...(admin ? [{ label: 'Settings', href: `${base}/settings` }] : []),
  ];
  const logo = fileUrl(branding.logoFileId);
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={`${show.name} logo`} style={{ height: 44, maxWidth: 160, objectFit: 'contain' }} />
          ) : null}
          <div style={{ minWidth: 0 }}>
            <Group gap="xs">
              <h1 className="page-title" style={{ fontSize: 26 }}>
                {show.name}
              </h1>
              <Badge color={STATUS_COLOUR[show.status]}>{STATUS_LABEL[show.status]}</Badge>
            </Group>
            <Text fz="sm" c="dimmed">
              {branding.marketplaceName}
            </Text>
          </div>
        </Group>
        <Anchor href={`/${show.slug}`} target="_blank" rel="noopener" fz="sm" className="text-link">
          <Group gap={4}>
            Open the storefront /{show.slug} <IconExternalLink size={14} aria-hidden />
          </Group>
        </Anchor>
      </Group>
      <LinkTabs tabs={tabs} />
      <div>{children}</div>
    </Stack>
  );
}
