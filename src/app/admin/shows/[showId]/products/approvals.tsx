'use client';

import { useState } from 'react';
import { Badge, Button, Group, Paper, Stack, Text, Textarea } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { approveProductAction, rejectProductAction } from '@/app/catalogue-actions';

export type Waiting = { id: string; name: string; supplierName: string; categoryName: string; kind: 'new' | 'change'; lines: string[]; imageFileId: string | null };

function Item({ showId, w }: { showId: string; w: Waiting }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const approve = useAction(approveProductAction);
  const reject = useAction(rejectProductAction, { onSuccess: () => setRejecting(false) });
  return (
    <Paper withBorder radius="md" p="md" style={{ borderColor: 'var(--em-line)' }} data-testid={`waiting-${w.name}`}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group align="flex-start" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          {w.imageFileId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/files/${w.imageFileId}`} alt="" width={64} height={64} style={{ objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
          ) : null}
          <div>
            <Group gap="xs">
              <Text fw={650}>{w.name}</Text>
              <Badge color={w.kind === 'new' ? 'blue' : 'yellow'}>{w.kind === 'new' ? 'New product' : 'Change'}</Badge>
            </Group>
            <Text fz="sm" c="dimmed">
              {w.supplierName} · {w.categoryName}
            </Text>
            {w.lines.map((l) => (
              <Text key={l} fz="sm">
                {l}
              </Text>
            ))}
          </div>
        </Group>
        {!rejecting ? (
          <Group gap="xs">
            <Button size="xs" onClick={() => approve.run({ showId, productId: w.id })} loading={approve.pending}>
              Approve
            </Button>
            <Button size="xs" variant="default" onClick={() => setRejecting(true)}>
              Turn down
            </Button>
          </Group>
        ) : null}
      </Group>
      {rejecting ? (
        <Stack gap="xs" mt="sm">
          <Textarea label="Why? The supplier sees this." value={reason} onChange={(e) => setReason(e.currentTarget.value)} autosize minRows={2} error={reject.fieldErrors.reason} />
          <Group gap="xs">
            <Button size="xs" color="red" onClick={() => reject.run({ showId, productId: w.id, reason })} loading={reject.pending}>
              Turn it down
            </Button>
            <Button size="xs" variant="default" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </Group>
        </Stack>
      ) : null}
    </Paper>
  );
}

export function Approvals({ showId, waiting }: { showId: string; waiting: Waiting[] }) {
  if (!waiting.length) {
    return (
      <Text fz="sm" c="dimmed">
        Nothing waiting. New products and price changes from suppliers appear here.
      </Text>
    );
  }
  return (
    <Stack gap="sm">
      {waiting.map((w) => (
        <Item key={w.id} showId={showId} w={w} />
      ))}
    </Stack>
  );
}
