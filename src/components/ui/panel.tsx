import { Paper, Stack, Text, Title } from '@mantine/core';

/** A white section on the canvas, with an optional heading. */
export function Panel({ title, description, children, id }: { title?: string; description?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <Paper withBorder radius="md" p="lg" id={id} style={{ borderColor: 'var(--em-line)' }}>
      <Stack gap="md">
        {title || description ? (
          <div>
            {title ? (
              <Title order={2} fz="lg">
                {title}
              </Title>
            ) : null}
            {description ? (
              <Text fz="sm" c="dimmed" mt={4}>
                {description}
              </Text>
            ) : null}
          </div>
        ) : null}
        {children}
      </Stack>
    </Paper>
  );
}
