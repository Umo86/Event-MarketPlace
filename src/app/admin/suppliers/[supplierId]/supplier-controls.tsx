'use client';

import { useState } from 'react';
import { Badge, Button, Group, Stack, Table, Text, Textarea } from '@mantine/core';
import { Panel } from '@/components/ui/panel';
import { SupplierForm, type SupplierValues } from '@/components/suppliers/supplier-form';
import { LoginDetailsCard, type LoginDetails } from '@/components/suppliers/login-details';
import { useAction } from '@/lib/use-action';
import { pauseSupplierAction, resetSupplierLoginAction, updateSupplierAction } from '../actions';

type Member = { userId: string; name: string; email: string; role: 'owner' | 'staff'; signedIn: string | null; mustChangePassword: boolean; twoFactor: boolean };

export function SupplierAdminControls({ supplierId, supplierName, paused, details, members }: { supplierId: string; supplierName: string; paused: boolean; details: SupplierValues; members: Member[] }) {
  const [login, setLogin] = useState<LoginDetails | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const save = useAction(updateSupplierAction);
  const reset = useAction(resetSupplierLoginAction, {
    onSuccess: (d) => {
      setConfirming(null);
      if (d) setLogin(d.login);
    },
  });
  const pause = useAction(pauseSupplierAction, { onSuccess: () => setReason('') });

  return (
    <>
      <Panel title="Logins" description="The people who sign in for this supplier. Nothing is emailed: if someone has lost their password, make a new one-off password and pass it on.">
        {login ? <LoginDetailsCard login={login} supplierName={supplierName} /> : null}
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="sm" fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Person</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>Signed in</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {members.map((m) => (
                <Table.Tr key={m.userId}>
                  <Table.Td>
                    <Text fz="sm" fw={600}>
                      {m.name || m.email}
                    </Text>
                    <Text fz="xs" c="dimmed">
                      {m.email}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={m.role === 'owner' ? 'market' : 'gray'}>{m.role === 'owner' ? 'Owner' : 'Staff'}</Badge>
                  </Table.Td>
                  <Table.Td>
                    {m.signedIn ? `Last ${m.signedIn}` : 'Not yet'}
                    {m.mustChangePassword ? (
                      <Text fz="xs" c="dimmed">
                        Still on a one-off password
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    <Group justify="flex-end" gap="xs">
                      {confirming === m.userId ? (
                        <>
                          <Text fz="xs">Their current password stops working and they’re signed out.</Text>
                          <Button size="xs" color="orange" onClick={() => reset.run({ supplierId, userId: m.userId })} loading={reset.pending}>
                            Make new password
                          </Button>
                          <Button size="xs" variant="default" onClick={() => setConfirming(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button size="xs" variant="default" onClick={() => setConfirming(m.userId)}>
                          New one-off password
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Panel>

      <Panel title="Company details">
        <SupplierForm mode="edit" initial={details} pending={save.pending} errors={save.fieldErrors} onSubmit={(v) => save.run({ supplierId, ...v })} />
      </Panel>

      <Panel title={paused ? 'Paused' : 'Pause this supplier'} description={paused ? 'Their services are hidden and they take no new orders.' : 'Hides their services and stops new orders straight away. Paid orders are not affected.'}>
        {paused ? (
          <Group>
            <Button onClick={() => pause.run({ supplierId, paused: false })} loading={pause.pending}>
              Take off pause
            </Button>
          </Group>
        ) : (
          <Stack maw={560}>
            <Textarea label="Reason" description="Recorded in the audit log, and shown to the supplier." value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={300} autosize minRows={2} error={pause.fieldErrors.reason} />
            <Group>
              <Button color="red" variant="light" onClick={() => pause.run({ supplierId, paused: true, reason })} loading={pause.pending}>
                Pause supplier
              </Button>
            </Group>
          </Stack>
        )}
      </Panel>
    </>
  );
}
