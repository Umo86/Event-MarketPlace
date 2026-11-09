'use client';

import { useEffect } from 'react';
import { Button, Center, Code, Container, Group, Paper, Stack, Text } from '@mantine/core';

/** Shown when a page fails unexpectedly. Server error details never reach the browser; the reference matches the server log. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: string }).digest ?? '') : '';
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Center mih="70vh" py="xl">
      <Container size={480} w="100%">
        <Paper withBorder p="xl" radius="md" w="100%">
          <Stack gap="sm">
            <h1 className="page-title" style={{ fontSize: 28 }}>
              Something went wrong
            </h1>
            <Text c="dimmed" fz="sm">
              Sorry, that didn’t work. Please try again. If it keeps happening, contact Media10 and quote the reference below.
            </Text>
            {digest ? (
              <Text fz="xs" c="dimmed">
                Reference: <Code>{digest}</Code>
              </Text>
            ) : null}
            <Group>
              <Button onClick={() => retry()}>Try again</Button>
              <Button component="a" href="/" variant="default">
                Go to the home page
              </Button>
            </Group>
          </Stack>
        </Paper>
      </Container>
    </Center>
  );
}
