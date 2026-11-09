'use client';

import { useState } from 'react';
import { Alert, Button, PasswordInput, Stack } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { choosePasswordAction } from '../actions';

export function ChoosePasswordForm({ next }: { next: string }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const save = useAction(choosePasswordAction, { notifyErrors: false });
  const mismatch = again.length > 0 && again !== password;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!mismatch) save.run({ password, next });
      }}
    >
      <Stack>
        <PasswordInput label="New password" description="At least 12 characters. A short sentence works well." autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} error={save.fieldErrors.password} />
        <PasswordInput label="New password again" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.currentTarget.value)} error={mismatch ? 'The two passwords don’t match.' : undefined} />
        {save.error ? <Alert color="red">{save.error}</Alert> : null}
        <Button type="submit" size="md" loading={save.pending} disabled={!password || mismatch}>
          Save and continue
        </Button>
      </Stack>
    </form>
  );
}
