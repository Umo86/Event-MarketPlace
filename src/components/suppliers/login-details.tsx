'use client';

import { Alert, Button, Code, CopyButton, Group, Stack, Text } from '@mantine/core';

export type LoginDetails = { email: string; name: string; password: string | null; signInUrl: string; existingAccount: boolean };

/** The login to pass on by hand (nothing is emailed). Shown once: the password isn't kept anywhere readable. */
export function LoginDetailsCard({ login, supplierName }: { login: LoginDetails; supplierName: string }) {
  if (!login.password) {
    return (
      <Alert color="blue" title="They already have an account">
        <Text fz="sm">
          {login.email} already has an Event MarketPlace login, so it’s been linked to {supplierName}. They sign in with the password they already use, at {login.signInUrl}.
        </Text>
      </Alert>
    );
  }
  const first = login.name.split(' ')[0] || 'there';
  const message = [
    `Hi ${first},`,
    '',
    `${supplierName} is now set up on Event MarketPlace, where exhibitors at Media10’s shows order your services.`,
    '',
    `Sign in at: ${login.signInUrl}`,
    `Email: ${login.email}`,
    `One-off password: ${login.password}`,
    '',
    'You’ll be asked to choose your own password when you first sign in. Then connect your Stripe account so you can be paid.',
  ].join('\n');
  return (
    <Alert color="green" title="Login details to pass on">
      <Stack gap="xs">
        <Text fz="sm">Send these to the supplier yourself, ideally the password separately from the email address. You won’t see this password again; if it’s lost, make a new one from the supplier’s page.</Text>
        <Text fz="sm">
          Sign in at: <Code>{login.signInUrl}</Code>
        </Text>
        <Text fz="sm">
          Email: <Code>{login.email}</Code>
        </Text>
        <Text fz="sm">
          One-off password: <Code data-testid="one-off-password">{login.password}</Code>
        </Text>
        <Group gap="xs">
          <CopyButton value={login.password}>
            {({ copied, copy }) => (
              <Button size="xs" variant="light" onClick={copy}>
                {copied ? 'Copied' : 'Copy password'}
              </Button>
            )}
          </CopyButton>
          <CopyButton value={message}>
            {({ copied, copy }) => (
              <Button size="xs" variant="default" onClick={copy}>
                {copied ? 'Copied' : 'Copy a ready-to-send message'}
              </Button>
            )}
          </CopyButton>
        </Group>
      </Stack>
    </Alert>
  );
}
