'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Loader, Stack, Text } from '@mantine/core';
import { linkSignInAction } from '../../actions';

export function LinkSignIn({ slug }: { slug: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    // Out of the address at once, so it isn't kept in history or shared by accident.
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      queueMicrotask(() => setProblem('This sign-in link is incomplete. Open the marketplace from the exhibitor manual again, or sign in with an emailed code.'));
      return;
    }
    void linkSignInAction({ slug, token }).then((res) => {
      if (!res) return; // Signed in: the server is taking the browser to the storefront.
      if (!res.ok) setProblem(res.error);
      else if (res.data?.problem) setProblem(res.data.problem);
    });
  }, [slug]);

  if (problem) {
    return (
      <Stack>
        <Alert color="orange" title="We couldn’t sign you in">
          {problem}
        </Alert>
        <Button component={Link} href={`/${slug}/sign-in`}>
          Sign in with an emailed code
        </Button>
      </Stack>
    );
  }
  return (
    <Stack align="center" py="lg">
      <Loader aria-label="Signing you in" />
      <Text>Signing you in…</Text>
    </Stack>
  );
}
