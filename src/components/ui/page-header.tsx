import { Group, Stack, Text } from '@mantine/core';

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="md">
      <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
        {eyebrow ? (
          <Text fz="sm" fw={600} c="dimmed">
            {eyebrow}
          </Text>
        ) : null}
        <h1 className="page-title" style={{ fontSize: 30 }}>
          {title}
        </h1>
        {description ? (
          <Text c="dimmed" fz="sm" maw={760}>
            {description}
          </Text>
        ) : null}
      </Stack>
      {actions ? <Group gap="xs">{actions}</Group> : null}
    </Group>
  );
}
