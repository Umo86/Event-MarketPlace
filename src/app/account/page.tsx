import type { Metadata } from 'next';
import { LinkAnchor } from '@/components/ui/links';
import { Badge, Group, Stack, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { getCurrentAuth, requireActor } from '@/server/auth/current';
import { twoFactorOn } from '@/server/env';
import { PasswordForm } from './password-form';

export const metadata: Metadata = { title: 'Your account' };

export default async function AccountPage() {
  const { actor } = await requireActor('account.manage');
  const auth = await getCurrentAuth();
  const user = auth!.user;
  return (
    <>
      <PageHeader title="Your account" description={`${actor.kind === 'user' ? actor.name || actor.email : ''} · ${user.email}`} />
      <Stack gap="lg" maw={720}>
        <Panel title="Two-factor sign-in">
          <Group>
            <Badge color={user.totpEnabledAt ? 'green' : 'orange'}>{user.totpEnabledAt ? 'On' : 'Off'}</Badge>
            {!user.totpEnabledAt && twoFactorOn() ? (
              <LinkAnchor href="/two-factor-setup" className="text-link">
                Turn on two-factor sign-in
              </LinkAnchor>
            ) : null}
          </Group>
          <Text fz="sm" c="dimmed">
            Lost your phone and your recovery codes? Ask a super admin to reset it.
          </Text>
        </Panel>
        <Panel title={user.passwordHash ? 'Change your password' : 'Set a password'} description="At least 12 characters. For your security you need to have signed in within the last 15 minutes.">
          <PasswordForm />
        </Panel>
      </Stack>
    </>
  );
}
