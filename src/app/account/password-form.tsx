'use client';

import { useState } from 'react';
import { Button, Group, PasswordInput, Stack } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { setPasswordAction } from './actions';

export function PasswordForm() {
  const [password, setPassword] = useState('');
  const save = useAction(setPasswordAction, { onSuccess: () => setPassword('') });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.run({ password });
      }}
    >
      <Stack maw={420}>
        <PasswordInput label="New password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} error={save.fieldErrors.password} />
        <Group>
          <Button type="submit" loading={save.pending}>
            Save password
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
