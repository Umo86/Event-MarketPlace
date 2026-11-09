import { LinkButton } from '@/components/ui/links';
import { Stack, Text } from '@mantine/core';
import { AuthCard } from '@/components/auth-card';
import { getCurrentAuth } from '@/server/auth/current';

export default async function Home() {
  const auth = await getCurrentAuth();
  return (
    <AuthCard title="Order stand services from approved suppliers" subtitle="Event MarketPlace runs the service shops for Media10’s shows: UK Construction Week, Futurebuild and Stone & Surface Show.">
      <Stack gap="xs">
        <Text fw={650}>Exhibitors</Text>
        <Text fz="sm" c="dimmed">
          Open your show’s marketplace from the exhibitor manual, or from the link the show team sent you.
        </Text>
      </Stack>
      <Stack gap="xs">
        <Text fw={650}>Media10 staff and suppliers</Text>
        <LinkButton href={auth ? '/admin' : '/sign-in'} w="fit-content">
          {auth ? 'Go to your shows' : 'Sign in'}
        </LinkButton>
      </Stack>
    </AuthCard>
  );
}
