import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Paper, Stack, Text } from '@mantine/core';
import { getExhibitor } from '@/server/auth/current';
import { storefrontOpenForSignIn } from '@/server/services/storefront-auth';
import { emailMode } from '@/server/env';
import { loadStorefront } from '../load';
import { StorefrontSignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function StorefrontSignIn({ params, searchParams }: PageProps<'/[show]/sign-in'>) {
  const { show: slug } = await params;
  const query = await searchParams;
  const { show, branding } = await loadStorefront(slug);
  if (await getExhibitor(show.id)) redirect(`/${show.slug}`);
  const open = storefrontOpenForSignIn(show);
  return (
    <Stack align="center" pt="md">
      <Paper withBorder radius="md" p="xl" w="100%" maw={460} style={{ borderColor: 'var(--em-line)' }}>
        <Stack>
          <div>
            <h1 className="page-title" style={{ fontSize: 28 }}>
              Sign in
            </h1>
            <Text c="dimmed" mt={6} fz="sm">
              Order services for your stand at {show.name}. Use the email address the show team has for you.
            </Text>
          </div>
          {open ? (
            <StorefrontSignInForm slug={show.slug} marketplaceName={branding.marketplaceName} signedOut={query.signedOut === '1'} canEmail={emailMode() !== 'off'} helpEmail={show.helpEmail} />
          ) : (
            <Text>
              This marketplace isn’t open yet. {show.helpEmail ? `Questions? Email ${show.helpEmail}.` : 'The show team will let you know when it opens.'}
            </Text>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
