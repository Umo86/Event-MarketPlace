'use client';

import { useState } from 'react';
import { Button, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconExternalLink, IconRefresh } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { checkStripeAction, startStripeAction } from '@/app/supplier/actions';

/** "Connect with Stripe" (owners), "Check status" (anyone on the team) and a link to their Stripe dashboard. */
export function ConnectButtons({ supplierId, connected, ready, isOwner, dashboardUrl }: { supplierId: string; connected: boolean; ready: boolean; isOwner: boolean; dashboardUrl: string | null }) {
  const [leaving, setLeaving] = useState(false);
  const start = useAction(startStripeAction, {
    onSuccess: (d) => {
      if (!d?.url) return;
      setLeaving(true);
      window.location.assign(d.url);
    },
  });
  const check = useAction(checkStripeAction, {
    onSuccess: (d) => notifications.show({ color: d?.ready ? 'green' : 'yellow', message: d?.ready ? 'Stripe says you can take payments. You’re ready to sell.' : 'Stripe still needs something from you. Carry on with Stripe to see what.' }),
  });
  return (
    <Group gap="sm">
      {isOwner && !ready ? (
        <Button onClick={() => start.run({ supplierId })} loading={start.pending || leaving}>
          {connected ? 'Carry on with Stripe' : 'Connect with Stripe'}
        </Button>
      ) : null}
      {connected ? (
        <Button variant="default" leftSection={<IconRefresh size={16} aria-hidden />} onClick={() => check.run({ supplierId })} loading={check.pending}>
          Check status
        </Button>
      ) : null}
      {connected && dashboardUrl ? (
        <Button component="a" href={dashboardUrl} target="_blank" rel="noopener" variant="subtle" rightSection={<IconExternalLink size={14} aria-hidden />}>
          Open your Stripe dashboard
        </Button>
      ) : null}
    </Group>
  );
}
