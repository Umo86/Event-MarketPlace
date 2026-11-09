'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppShell, Avatar, Burger, Group, Menu, NavLink, Stack, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconBuildingStore, IconChevronDown, IconHistory, IconHome, IconLogout, IconSettings, IconTruckDelivery, IconUserCircle } from '@tabler/icons-react';
import { Wordmark } from './auth-card';
import { signOutAction } from '@/app/(auth)/actions';

export type ShellUser = { name: string; email: string };

/** Icons by name, so server layouts can pass plain data. */
const ICONS = {
  shows: IconBuildingStore,
  suppliers: IconTruckDelivery,
  settings: IconSettings,
  audit: IconHistory,
  account: IconUserCircle,
  home: IconHome,
};
export type NavItem = { label: string; href: string; icon: keyof typeof ICONS; exact?: boolean; also?: string[] };

function initials(name: string, email: string) {
  const parts = (name.trim() || email).split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/**
 * The plain Event MarketPlace frame, for Media10 staff and for suppliers. Show and supplier pages
 * add their own name (and the show's logo) above their content.
 */
export function AdminShell({ user, nav, home = '/start', children }: { user: ShellUser; nav: NavItem[]; home?: string; children: React.ReactNode }) {
  const [opened, { toggle, close }] = useDisclosure();
  const pathname = usePathname();
  const under = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : under(item.href)) || (item.also ?? []).some(under);
  return (
    <AppShell header={{ height: 60 }} navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="lg" styles={{ main: { background: 'var(--em-canvas)' } }}>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <AppShell.Header style={{ borderColor: 'var(--em-line)' }}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Open navigation" />
            <Link href={home} style={{ textDecoration: 'none' }} aria-label="Event MarketPlace home">
              <Wordmark />
            </Link>
          </Group>
          <Menu position="bottom-end" width={240}>
            <Menu.Target>
              <UnstyledButton aria-label="Account menu">
                <Group gap={6} wrap="nowrap">
                  <Avatar size={32} radius="xl" color="market">
                    {initials(user.name, user.email)}
                  </Avatar>
                  <IconChevronDown size={14} />
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>
                <Text fz="sm" fw={600} c="var(--mantine-color-text)">
                  {user.name || user.email}
                </Text>
                <Text fz="xs">{user.email}</Text>
              </Menu.Label>
              <Menu.Item component={Link} href="/account" leftSection={<IconUserCircle size={16} />}>
                Your account
              </Menu.Item>
              <form action={signOutAction}>
                <Menu.Item component="button" type="submit" leftSection={<IconLogout size={16} />}>
                  Sign out
                </Menu.Item>
              </form>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm" style={{ borderColor: 'var(--em-line)' }}>
        <Stack gap={2} component="nav" aria-label="Main">
          {nav.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(item);
            return <NavLink key={item.href} component={Link} href={item.href} label={item.label} leftSection={<Icon size={18} />} active={active} onClick={close} aria-current={active ? 'page' : undefined} />;
          })}
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main id="content" tabIndex={-1}>
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>{children}</div>
      </AppShell.Main>
    </AppShell>
  );
}
