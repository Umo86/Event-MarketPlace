import { LinkButton } from '@/components/ui/links';
import { Text } from '@mantine/core';
import { AuthCard } from '@/components/auth-card';

export default function NotFound() {
  return (
    <AuthCard title="We couldn’t find that page">
      <Text fz="sm">The address may be wrong, or the page may have moved. If you followed a link from the show team, ask them for a new one.</Text>
      <LinkButton href="/" variant="default" w="fit-content">
        Go to the home page
      </LinkButton>
    </AuthCard>
  );
}
