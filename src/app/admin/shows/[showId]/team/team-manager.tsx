'use client';

import { useState } from 'react';
import { Badge, Button, Checkbox, Group, Radio, Stack, Table, Text, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { inviteTeamAction, removeTeamMemberAction, revokeTeamInviteAction, updateTeamMemberAction } from '../../../actions';

type Right = 'orders' | 'exhibitors' | 'reports' | 'refunds';
const RIGHTS: { value: Right; label: string }[] = [
  { value: 'exhibitors', label: 'Exhibitors' },
  { value: 'orders', label: 'Orders' },
  { value: 'reports', label: 'Reports' },
  { value: 'refunds', label: 'Refunds' },
];
type Member = { userId: string; name: string; email: string; role: 'show_admin' | 'show_team'; permissions: Right[]; twoFactor: boolean };
type Pending = { id: string; email: string; role: string | null; expires: string };

function RightsPicker({ value, onChange }: { value: Right[]; onChange: (v: Right[]) => void }) {
  return (
    <Checkbox.Group value={value} onChange={(v) => onChange(v as Right[])} label="Rights">
      <Group mt={6} gap="md">
        {RIGHTS.map((r) => (
          <Checkbox key={r.value} value={r.value} label={r.label} />
        ))}
      </Group>
    </Checkbox.Group>
  );
}

function MemberRow({ showId, m, me, canManage }: { showId: string; m: Member; me: string; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(m.role);
  const [rights, setRights] = useState<Right[]>(m.permissions);
  const save = useAction(updateTeamMemberAction, { onSuccess: () => setEditing(false) });
  const remove = useAction(removeTeamMemberAction);
  return (
    <Table.Tr>
      <Table.Td>
        <Text fz="sm" fw={600}>
          {m.name || m.email}
        </Text>
        <Text fz="xs" c="dimmed">
          {m.email}
        </Text>
      </Table.Td>
      <Table.Td>
        {editing ? (
          <Stack gap="xs">
            <Radio.Group value={role} onChange={(v) => setRole(v as Member['role'])}>
              <Group gap="md">
                <Radio value="show_admin" label="Show admin" />
                <Radio value="show_team" label="Team member" />
              </Group>
            </Radio.Group>
            {role === 'show_team' ? <RightsPicker value={rights} onChange={setRights} /> : null}
            <Group gap="xs">
              <Button size="xs" onClick={() => save.run({ showId, userId: m.userId, role, permissions: rights })} loading={save.pending}>
                Save
              </Button>
              <Button size="xs" variant="default" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </Group>
          </Stack>
        ) : (
          <Group gap={6}>
            <Badge color={m.role === 'show_admin' ? 'market' : 'gray'}>{m.role === 'show_admin' ? 'Show admin' : 'Team member'}</Badge>
            {m.role === 'show_team' ? <Text fz="xs">{m.permissions.length ? m.permissions.map((p) => RIGHTS.find((r) => r.value === p)?.label).join(', ') : 'View only'}</Text> : null}
          </Group>
        )}
      </Table.Td>
      <Table.Td>
        <Badge color={m.twoFactor ? 'green' : 'orange'}>{m.twoFactor ? 'Two-factor on' : 'Two-factor not set up'}</Badge>
      </Table.Td>
      <Table.Td>
        {canManage && !editing && m.userId !== me ? (
          <Group gap="xs" justify="flex-end">
            <Button size="xs" variant="default" onClick={() => setEditing(true)}>
              Change
            </Button>
            <Button size="xs" variant="subtle" color="red" onClick={() => remove.run({ showId, userId: m.userId })} loading={remove.pending}>
              Remove
            </Button>
          </Group>
        ) : null}
      </Table.Td>
    </Table.Tr>
  );
}

export function TeamManager({ showId, me, canManage, members, pending }: { showId: string; me: string; canManage: boolean; members: Member[]; pending: Pending[] }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'show_admin' | 'show_team'>('show_team');
  const [rights, setRights] = useState<Right[]>(['orders']);
  const invite = useAction(inviteTeamAction, { onSuccess: () => setEmail('') });
  const revoke = useAction(revokeTeamInviteAction);
  return (
    <Stack gap="lg">
      <Table.ScrollContainer minWidth={640}>
        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Person</Table.Th>
              <Table.Th>Role and rights</Table.Th>
              <Table.Th>Sign-in</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {members.map((m) => (
              <MemberRow key={m.userId} showId={showId} m={m} me={me} canManage={canManage} />
            ))}
            {pending.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>
                  <Text fz="sm">{p.email}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge color="yellow">Invited</Badge>
                </Table.Td>
                <Table.Td>
                  <Text fz="xs" c="dimmed">
                    Invitation works until {p.expires}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {canManage ? (
                    <Group justify="flex-end">
                      <Button size="xs" variant="subtle" color="red" onClick={() => revoke.run({ showId, invitationId: p.id })}>
                        Cancel invitation
                      </Button>
                    </Group>
                  ) : null}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {canManage ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            invite.run({ showId, email, role, permissions: rights });
          }}
        >
          <Stack gap="sm" maw={560}>
            <Text fw={650}>Invite someone</Text>
            <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} error={invite.fieldErrors.email} />
            <Radio.Group label="Role" value={role} onChange={(v) => setRole(v as typeof role)}>
              <Group mt={6} gap="md">
                <Radio value="show_team" label="Team member" />
                <Radio value="show_admin" label="Show admin" />
              </Group>
            </Radio.Group>
            {role === 'show_team' ? <RightsPicker value={rights} onChange={setRights} /> : null}
            <Group>
              <Button type="submit" loading={invite.pending}>
                Send invitation
              </Button>
            </Group>
          </Stack>
        </form>
      ) : null}
    </Stack>
  );
}
