'use client';

import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconRefresh } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { adminCheckStripeAction } from '../actions';

export function AdminCheckStripe({ supplierId }: { supplierId: string }) {
  const check = useAction(adminCheckStripeAction, {
    onSuccess: (d) => notifications.show({ color: d?.ready ? 'green' : 'yellow', message: d?.ready ? 'Stripe says they can take payments.' : 'Stripe still needs details from them.' }),
  });
  return (
    <Button variant="default" size="xs" leftSection={<IconRefresh size={14} aria-hidden />} onClick={() => check.run({ supplierId })} loading={check.pending}>
      Check with Stripe
    </Button>
  );
}
