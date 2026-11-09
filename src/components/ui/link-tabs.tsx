'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Group, UnstyledButton } from '@mantine/core';

/** Tabs that are links (each tab is its own page), underlined when current. */
export function LinkTabs({ tabs }: { tabs: { label: string; href: string; exact?: boolean }[] }) {
  const pathname = usePathname();
  return (
    <Group gap={4} component="nav" aria-label="Show sections" style={{ borderBottom: '1px solid var(--em-line)', overflowX: 'auto', flexWrap: 'nowrap' }}>
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <UnstyledButton
            key={t.href}
            component={Link}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            px="sm"
            py={10}
            style={{
              fontSize: 14,
              fontWeight: active ? 650 : 500,
              color: active ? 'var(--em-ink)' : 'var(--em-muted)',
              borderBottom: `2px solid ${active ? 'var(--mantine-color-market-6)' : 'transparent'}`,
              marginBottom: -1,
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </UnstyledButton>
        );
      })}
    </Group>
  );
}
