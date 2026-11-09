import type { Metadata } from 'next';
import { Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { requireActor } from '@/server/auth/current';
import { getPlatformBranding } from '@/server/services/settings';
import { PlatformForms } from './platform-forms';

export const metadata: Metadata = { title: 'Platform settings' };

export default async function PlatformPage() {
  await requireActor('platform.settings.edit');
  const b = await getPlatformBranding();
  return (
    <>
      <PageHeader title="Platform settings" description="For super admins. These apply to every show." />
      <Stack gap="lg">
        <Panel title="Default branding" description="Storefronts without their own name or colours use these.">
          <PlatformForms initial={{ marketplaceName: b.marketplaceName, primaryColor: b.primaryColor, accentColor: b.accentColor }} />
        </Panel>
      </Stack>
    </>
  );
}
