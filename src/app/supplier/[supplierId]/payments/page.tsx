import type { Metadata } from 'next';
import { Alert, Badge, Group, List, ListItem, Stack, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { ConnectButtons } from '@/components/suppliers/connect-buttons';
import { connectViewForMember } from '@/server/services/connect';
import { dateTime } from '@/lib/format';
import { loadSupplier } from '../load';

export const metadata: Metadata = { title: 'Payments' };

/**
 * Connecting the supplier's own Stripe account. Exhibitors' payments go straight into it (the
 * supplier is the seller); Media10's commission is taken by Stripe as each payment is made.
 */
export default async function SupplierPaymentsPage({ params, searchParams }: PageProps<'/supplier/[supplierId]/payments'>) {
  const { supplierId } = await params;
  const sp = await searchParams;
  const { actor, supplier: s, role } = await loadSupplier(supplierId);
  const c = await connectViewForMember(actor, supplierId);
  const ready = c.flags.chargesEnabled;
  return (
    <>
      <PageHeader eyebrow={s.name} title="Payments" description="Exhibitors pay you directly, through your own Stripe account. Media10 never sees or keeps your bank details." />
      <Stack gap="lg">
        {sp.stripe === 'return' && !ready ? (
          <Alert color="yellow" title="Thanks. Stripe is checking your details">
            This can take a few minutes. If Stripe still needs anything, it will say so when you carry on. Press “Check status” to see the latest.
          </Alert>
        ) : null}
        {sp.stripe === 'expired' ? (
          <Alert color="yellow" title="That Stripe link has run out">
            Press “Carry on with Stripe” to get a new one.
          </Alert>
        ) : null}
        <Panel title="Your Stripe account">
          <Group gap="xs">
            {ready ? (
              <Badge color="green" size="lg">
                Ready to sell
              </Badge>
            ) : c.connected ? (
              <Badge color="yellow" size="lg">
                Set-up not finished
              </Badge>
            ) : (
              <Badge color="gray" size="lg">
                Not connected
              </Badge>
            )}
            {c.mode === 'simulator' ? (
              <Badge color="orange" variant="light">
                Test mode: payment simulator
              </Badge>
            ) : c.testMode ? (
              <Badge color="orange" variant="light">
                Stripe test mode
              </Badge>
            ) : null}
          </Group>
          {c.mode === null ? (
            <Text fz="sm">Card payments aren’t switched on yet. Media10 will let you know when you can connect.</Text>
          ) : ready ? (
            <Text fz="sm">Stripe can take payments for you. Your services can be shown to exhibitors once you’ve added them.</Text>
          ) : (
            <Stack gap="xs">
              <Text fz="sm">
                {c.connected
                  ? 'You’ve started connecting. Carry on with Stripe to finish: it shows you anything it still needs.'
                  : 'Connect with Stripe to take payments. You’ll go to Stripe’s own pages to give your business and bank details, then come back here.'}
              </Text>
              <List fz="sm" spacing={4}>
                <ListItem>Have your company details, a bank account and the owner’s ID to hand.</ListItem>
                <ListItem>Already use Stripe? You can sign in with your Stripe login while you set up.</ListItem>
              </List>
              {role !== 'owner' ? (
                <Text fz="sm" c="dimmed">
                  Only your account owner can connect Stripe.
                </Text>
              ) : null}
            </Stack>
          )}
          {c.mode ? <ConnectButtons supplierId={supplierId} connected={c.connected} ready={ready} isOwner={role === 'owner'} dashboardUrl={c.dashboardUrl} /> : null}
          {c.connected ? (
            <Text fz="xs" c="dimmed">
              Payouts to your bank: {c.flags.payoutsEnabled ? 'on' : 'not on yet'}. {c.checkedAt ? `Last checked ${dateTime(c.checkedAt)}.` : ''}
            </Text>
          ) : null}
        </Panel>
      </Stack>
    </>
  );
}
