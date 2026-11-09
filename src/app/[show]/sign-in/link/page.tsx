import type { Metadata } from 'next';
import { Paper, Stack } from '@mantine/core';
import { loadStorefront } from '../../load';
import { LinkSignIn } from './link-sign-in';

export const metadata: Metadata = { title: 'Signing you in', referrer: 'no-referrer' };

/**
 * Where BluePrint and Billie send exhibitors: /<show>/sign-in/link#token=…
 * The token is after the "#", so it never reaches a server log; the page takes it out of the address
 * straight away and checks it with the server.
 */
export default async function LinkSignInPage({ params }: PageProps<'/[show]/sign-in/link'>) {
  const { show: slug } = await params;
  const { show } = await loadStorefront(slug);
  return (
    <Stack align="center" pt="md">
      <Paper withBorder radius="md" p="xl" w="100%" maw={460} style={{ borderColor: 'var(--em-line)' }}>
        <LinkSignIn slug={show.slug} />
      </Paper>
    </Stack>
  );
}
