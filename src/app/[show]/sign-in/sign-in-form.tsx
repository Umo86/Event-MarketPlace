'use client';

import { useState } from 'react';
import { Alert, Anchor, Button, PinInput, Stack, Text, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { requestStorefrontCodeAction, verifyStorefrontCodeAction } from '../actions';

export function StorefrontSignInForm({ slug, marketplaceName, signedOut, canEmail, helpEmail }: { slug: string; marketplaceName: string; signedOut: boolean; canEmail: boolean; helpEmail: string | null }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const request = useAction(requestStorefrontCodeAction, { onSuccess: () => setSent(true), notifyErrors: false });
  const verify = useAction(verifyStorefrontCodeAction, { notifyErrors: false });

  if (!canEmail) {
    return <Alert color="orange">Signing in by email isn’t switched on yet. Open the marketplace from the exhibitor manual instead{helpEmail ? `, or contact ${helpEmail}` : ''}.</Alert>;
  }

  if (sent) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          verify.run({ slug, email, code });
        }}
      >
        <Stack>
          <Text fz="sm">
            If <strong>{email}</strong> is on the exhibitor list for this show, we’ve sent a code from {marketplaceName}. It expires in 10 minutes.
          </Text>
          <div>
            <Text component="label" htmlFor="code" fz="sm" fw={600} mb={6} display="block">
              Six-digit code
            </Text>
            <PinInput id="code" length={6} type="number" oneTimeCode value={code} onChange={setCode} aria-label="Six-digit code" autoFocus />
          </div>
          {verify.error ? <Alert color="red">{verify.error}</Alert> : null}
          <Button type="submit" size="md" loading={verify.pending} disabled={code.length !== 6}>
            Sign in
          </Button>
          <Anchor component="button" type="button" fz="sm" onClick={() => request.run({ slug, email })}>
            Send a new code
          </Anchor>
          <Anchor component="button" type="button" fz="sm" c="dimmed" onClick={() => setSent(false)}>
            Use a different email
          </Anchor>
          <Text fz="xs" c="dimmed">
            No email? Check your spam folder. If it still hasn’t arrived, the show team may have a different address for you{helpEmail ? `: contact ${helpEmail}` : ''}.
          </Text>
        </Stack>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        request.run({ slug, email });
      }}
    >
      <Stack>
        {signedOut ? <Alert color="green">You’ve signed out.</Alert> : null}
        <TextInput label="Email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.currentTarget.value)} error={request.fieldErrors.email} />
        {request.error ? <Alert color="red">{request.error}</Alert> : null}
        <Button type="submit" size="md" loading={request.pending}>
          Email me a sign-in code
        </Button>
      </Stack>
    </form>
  );
}
