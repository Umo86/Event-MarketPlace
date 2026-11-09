'use client';

import { useState } from 'react';
import { Button, ColorInput, Divider, Group, Stack, Text, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { checkAccentColour, checkMainColour } from '@/lib/branding';
import { inviteSuperAdminAction, updatePlatformBrandingAction } from '../actions';

export function PlatformForms({ initial }: { initial: { marketplaceName: string; primaryColor: string; accentColor: string } }) {
  const [v, setV] = useState(initial);
  const [email, setEmail] = useState('');
  const save = useAction(updatePlatformBrandingAction);
  const invite = useAction(inviteSuperAdminAction, { onSuccess: () => setEmail('') });
  const main = checkMainColour(v.primaryColor);
  const accent = checkAccentColour(v.accentColor);
  return (
    <Stack gap="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.run(v);
        }}
      >
        <Stack maw={520}>
          <TextInput label="Platform name" required value={v.marketplaceName} onChange={(e) => setV({ ...v, marketplaceName: e.currentTarget.value })} error={save.fieldErrors.marketplaceName} />
          <ColorInput label="Main colour" format="hex" value={v.primaryColor} onChange={(c) => setV({ ...v, primaryColor: c })} error={save.fieldErrors.primaryColor ?? (!main.ok ? main.message : undefined)} />
          <ColorInput label="Accent colour" format="hex" value={v.accentColor} onChange={(c) => setV({ ...v, accentColor: c })} error={save.fieldErrors.accentColor ?? (!accent.ok ? accent.message : undefined)} />
          <Group>
            <Button type="submit" loading={save.pending} disabled={!main.ok || !accent.ok}>
              Save defaults
            </Button>
          </Group>
        </Stack>
      </form>
      <Divider />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          invite.run({ email });
        }}
      >
        <Stack maw={520} gap="sm">
          <Text fw={650}>Add a super admin</Text>
          <Text fz="sm" c="dimmed">
            Super admins can do everything on every show. Only invite Media10 platform owners.
          </Text>
          <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} error={invite.fieldErrors.email} />
          <Group>
            <Button type="submit" variant="default" loading={invite.pending}>
              Send invitation
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
