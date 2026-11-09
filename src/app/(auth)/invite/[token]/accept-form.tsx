'use client';

import { useState } from 'react';
import { Alert, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { acceptInviteAction, sendInviteCodeAction } from '../../actions';

const intro: Record<string, string> = {
  show_staff: 'You’ll help run the show’s marketplace. Media10 staff accounts use two-factor sign-in.',
  super_admin: 'You’ll have full control of Event MarketPlace. Super admin accounts use two-factor sign-in.',
  supplier: 'You’ll manage your catalogue and orders, and connect Stripe to get paid.',
};

export function AcceptInviteForm({ token, needsEmailCode, existingName, hasPassword, kind }: { token: string; needsEmailCode: boolean; existingName: string; hasPassword: boolean; kind: string }) {
  const [name, setName] = useState(existingName);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const sendCode = useAction(sendInviteCodeAction, { onSuccess: () => setCodeSent(true) });
  const accept = useAction(acceptInviteAction, { notifyErrors: false });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        accept.run({ token, name, code: needsEmailCode ? code : null, password: password || null });
      }}
    >
      <Stack>
        <Text fz="sm">{intro[kind] ?? ''}</Text>
        <TextInput label="Your name" autoComplete="name" required value={name} onChange={(e) => setName(e.currentTarget.value)} error={accept.fieldErrors.name} maxLength={120} />
        {hasPassword ? null : (
          <PasswordInput
            label="Choose a password (optional)"
            description="At least 12 characters. Leave blank to sign in with emailed codes instead."
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            error={accept.fieldErrors.password}
          />
        )}
        {needsEmailCode ? (
          <>
            <Text fz="sm" c="dimmed">
              To keep your account safe, we’ll email you a code to confirm this is your address.
            </Text>
            {codeSent ? (
              <TextInput label="Code from the email" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.currentTarget.value)} error={accept.fieldErrors.code} />
            ) : null}
            <Button variant={codeSent ? 'subtle' : 'light'} onClick={() => sendCode.run({ token })} loading={sendCode.pending}>
              {codeSent ? 'Send another code' : 'Email me a code'}
            </Button>
          </>
        ) : null}
        {accept.error ? <Alert color="red">{accept.error}</Alert> : null}
        <Button type="submit" size="md" loading={accept.pending} disabled={needsEmailCode && !codeSent}>
          Accept and continue
        </Button>
      </Stack>
    </form>
  );
}
