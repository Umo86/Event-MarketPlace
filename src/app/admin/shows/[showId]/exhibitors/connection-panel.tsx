'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Code, CopyButton, Group, Stack, Text } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { makeConnectionKeyAction, removeConnectionKeyAction } from '../../../actions';

type Props = { showId: string; slug: string; appUrl: string; keyId: string | null; createdAt: string | null; lastSync: string | null; lastSignIn: string | null };

/** Makes the show's key for BluePrint (shown once), and says where BluePrint sends things. */
export function ConnectionPanel({ showId, slug, appUrl, keyId, createdAt, lastSync, lastSignIn }: Props) {
  const router = useRouter();
  const [key, setKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const make = useAction(makeConnectionKeyAction, {
    onSuccess: (d) => {
      setKey(d?.key ?? null);
      setConfirming(false);
      router.refresh();
    },
  });
  const remove = useAction(removeConnectionKeyAction, { onSuccess: () => router.refresh() });
  const base = appUrl.replace(/\/$/, '');
  return (
    <Stack>
      {key ? (
        <Alert color="green" title="Copy this key now">
          <Stack gap="xs">
            <Text fz="sm">Put it in this show’s settings in BluePrint. It won’t be shown again. If it’s lost, make a new one.</Text>
            <Code block style={{ wordBreak: 'break-all' }}>
              {key}
            </Code>
            <CopyButton value={key}>
              {({ copied, copy }) => (
                <Button size="xs" variant="light" onClick={copy} w="fit-content">
                  {copied ? 'Copied' : 'Copy key'}
                </Button>
              )}
            </CopyButton>
          </Stack>
        </Alert>
      ) : null}
      {keyId ? (
        <Text fz="sm">
          Connected with key <Code>em_{keyId}_…</Code>, made {createdAt}. Last list from BluePrint: {lastSync ?? 'none yet'}. Last sign-in from a link: {lastSignIn ?? 'none yet'}.
        </Text>
      ) : (
        <Text fz="sm" c="dimmed">
          Not connected. You can still upload the list by hand.
        </Text>
      )}
      <Stack gap={4}>
        <Text fz="sm">BluePrint sends the whole list to:</Text>
        <Code>POST {base}/api/public/shows/{slug}/exhibitors</Code>
        <Text fz="sm">and signs exhibitors in with a link to:</Text>
        <Code>{`${base}/${slug}/sign-in/link#token=…`}</Code>
        <Text fz="xs" c="dimmed">
          The full guide for BluePrint’s side is docs/blueprint.md in the Event MarketPlace code.
        </Text>
      </Stack>
      {confirming ? (
        <Alert color="orange" title="Replace the key?">
          <Text fz="sm">The current key stops working at once. BluePrint can’t send the list or sign people in until you put the new key in.</Text>
          <Group mt="sm">
            <Button size="xs" color="orange" onClick={() => make.run({ showId })} loading={make.pending}>
              Make a new key
            </Button>
            <Button size="xs" variant="default" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </Group>
        </Alert>
      ) : (
        <Group>
          <Button onClick={() => (keyId ? setConfirming(true) : make.run({ showId }))} loading={make.pending}>
            {keyId ? 'Make a new key' : 'Make a key'}
          </Button>
          {keyId ? (
            <Button variant="subtle" color="red" onClick={() => remove.run({ showId })} loading={remove.pending}>
              Disconnect
            </Button>
          ) : null}
        </Group>
      )}
    </Stack>
  );
}
