'use client';

import { useState } from 'react';
import { Button, Divider, Group, Radio, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { STATUS_HELP, STATUS_LABEL } from '@/lib/show-status';
import { updateShowSettingsAction } from '../../../actions';

type Values = {
  showId: string;
  name: string;
  venue: string;
  status: 'draft' | 'live' | 'closed' | 'archived';
  orderingOpensAt: string;
  earlyBirdEndsAt: string;
  latePricesFrom: string;
  orderingClosesAt: string;
  helpEmail: string;
  helpPhone: string;
  billieUrl: string;
};

export function SettingsForm({ initial }: { initial: Values }) {
  const [v, setV] = useState(initial);
  const save = useAction(updateShowSettingsAction);
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.currentTarget.value });
  const err = save.fieldErrors;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.run(v);
      }}
    >
      <Stack gap="lg" maw={720}>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Show name" required value={v.name} onChange={set('name')} error={err.name} />
          <TextInput label="Venue" value={v.venue} onChange={set('venue')} error={err.venue} />
        </SimpleGrid>

        <Radio.Group label="Status" value={v.status} onChange={(s) => setV({ ...v, status: s as Values['status'] })}>
          <Stack gap="xs" mt="xs">
            {(['draft', 'live', 'closed', 'archived'] as const).map((s) => (
              <Radio key={s} value={s} label={STATUS_LABEL[s]} description={STATUS_HELP[s]} />
            ))}
          </Stack>
        </Radio.Group>

        <Divider />
        <div>
          <Text fw={650}>Ordering dates</Text>
          <Text fz="sm" c="dimmed">
            UK time. Early-bird prices apply until they end; late prices from when they start.
          </Text>
        </div>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput type="datetime-local" label="Ordering opens" value={v.orderingOpensAt} onChange={set('orderingOpensAt')} error={err.orderingOpensAt} />
          <TextInput type="datetime-local" label="Early-bird prices end" value={v.earlyBirdEndsAt} onChange={set('earlyBirdEndsAt')} error={err.earlyBirdEndsAt} />
          <TextInput type="datetime-local" label="Late prices start" value={v.latePricesFrom} onChange={set('latePricesFrom')} error={err.latePricesFrom} />
          <TextInput type="datetime-local" label="Ordering closes" value={v.orderingClosesAt} onChange={set('orderingClosesAt')} error={err.orderingClosesAt} />
        </SimpleGrid>

        <Divider />
        <div>
          <Text fw={650}>Help for exhibitors</Text>
          <Text fz="sm" c="dimmed">
            Shown on the storefront and in emails.
          </Text>
        </div>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput type="email" label="Show contact email" value={v.helpEmail} onChange={set('helpEmail')} error={err.helpEmail} />
          <TextInput label="Show contact phone" value={v.helpPhone} onChange={set('helpPhone')} error={err.helpPhone} />
        </SimpleGrid>
        <TextInput label="Link to the show’s Billie chat (optional)" placeholder="https://" value={v.billieUrl} onChange={set('billieUrl')} error={err.billieUrl} />
        <Group>
          <Button type="submit" loading={save.pending}>
            Save settings
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
