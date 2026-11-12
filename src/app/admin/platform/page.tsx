import type { Metadata } from 'next';
import { Stack, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { requireActor } from '@/server/auth/current';
import { getPlatformBranding, getSetting } from '@/server/services/settings';
import { CommissionField } from '@/components/catalogue/commission-field';
import { PlatformForms } from './platform-forms';

export const metadata: Metadata = { title: 'Platform settings' };

export default async function PlatformPage() {
  await requireActor('platform.settings.edit');
  const [b, commission, commissionVat] = await Promise.all([getPlatformBranding(), getSetting('commissionDefault'), getSetting('commissionVat')]);
  return (
    <>
      <PageHeader title="Platform settings" description="For super admins. These apply to every show." />
      <Stack gap="lg">
        <Panel title="Default branding" description="Storefronts without their own name or colours use these.">
          <PlatformForms initial={{ marketplaceName: b.marketplaceName, primaryColor: b.primaryColor, accentColor: b.accentColor }} />
        </Panel>
        <Panel title="Default commission" description="Media10’s fee on each order line, before VAT, when no product, category, supplier or show sets its own.">
          <CommissionField target={{ kind: 'platform' }} type={commission.type} value={commission.value} label="Default commission" />
          <Text fz="sm" c="dimmed">
            VAT on commission: {commissionVat.chargeVat ? 'charged' : 'not charged'}. This waits for your accountant to confirm how it should be treated.
          </Text>
        </Panel>
      </Stack>
    </>
  );
}
