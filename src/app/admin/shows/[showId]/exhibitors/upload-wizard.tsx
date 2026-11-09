'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Checkbox, FileButton, Group, Stack, Table, Text } from '@mantine/core';
import { IconFileSpreadsheet } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { applyUploadAction, previewUploadAction } from '../../../actions';

type Preview = NonNullable<Extract<Awaited<ReturnType<typeof previewUploadAction>>, { ok: true }>['data']>;

const ACTION: Record<string, { label: string; color: string }> = {
  add: { label: 'New', color: 'green' },
  update: { label: 'Changed', color: 'blue' },
  same: { label: 'No change', color: 'gray' },
  remove: { label: 'Removed', color: 'red' },
  skip: { label: 'Skipped', color: 'orange' },
};

/** Upload, see exactly what would change, then apply. Nothing is saved until "Apply". */
export function UploadWizard({ showId }: { showId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const check = useAction(previewUploadAction, { onSuccess: (d) => d && setPreview(d) });
  const apply = useAction(applyUploadAction, {
    onSuccess: (c) => {
      setPreview(null);
      setFile(null);
      router.refresh();
      return c;
    },
    successMessage: 'The exhibitor list is updated.',
  });

  function runCheck(f: File | null, r: boolean) {
    if (!f) return;
    const form = new FormData();
    form.set('showId', showId);
    form.set('file', f);
    form.set('replace', r ? '1' : '0');
    void check.run(form);
  }

  if (preview) {
    const c = preview.plan.counts;
    const usable = preview.rows.filter((r) => !r.problems.length);
    const changes = preview.plan.entries.filter((e) => e.action !== 'same');
    return (
      <Stack>
        <Text fz="sm">
          <strong>{preview.fileName}</strong>: {c.add} new, {c.update} changed, {c.same} unchanged{replace ? `, ${c.remove} removed` : ''}, {c.skip} skipped.
        </Text>
        {preview.plan.newHalls.length || preview.plan.newStandTypes.length ? (
          <Alert color="blue">
            {preview.plan.newHalls.length ? `New halls: ${preview.plan.newHalls.join(', ')}. ` : ''}
            {preview.plan.newStandTypes.length ? `New stand types: ${preview.plan.newStandTypes.join(', ')}. Services can be limited to stand types later.` : ''}
          </Alert>
        ) : null}
        {changes.length ? (
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing={6} fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Row</Table.Th>
                  <Table.Th>What happens</Table.Th>
                  <Table.Th>Company</Table.Th>
                  <Table.Th>Stand</Table.Th>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Details</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {changes.slice(0, 300).map((e, i) => (
                  <Table.Tr key={`${e.line}-${e.email}-${i}`}>
                    <Table.Td>{e.line ?? '—'}</Table.Td>
                    <Table.Td>
                      <Badge color={ACTION[e.action].color}>{ACTION[e.action].label}</Badge>
                    </Table.Td>
                    <Table.Td>{e.company}</Table.Td>
                    <Table.Td>{e.stand}</Table.Td>
                    <Table.Td>{e.email}</Table.Td>
                    <Table.Td>{[...e.problems, ...e.changes].join(' ')}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text fz="sm" c="dimmed">
            Nothing would change.
          </Text>
        )}
        <Group>
          <Button onClick={() => apply.run({ showId, replace, fileName: preview.fileName, rows: usable })} loading={apply.pending} disabled={!usable.length || (!c.add && !c.update && !c.remove)}>
            Apply these changes
          </Button>
          <Button variant="default" onClick={() => setPreview(null)}>
            Cancel
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack>
      <Checkbox
        label="Remove anyone not in this file"
        description="Use this when the file is the whole list. Removed exhibitors can’t sign in, but their past orders are kept."
        checked={replace}
        onChange={(e) => setReplace(e.currentTarget.checked)}
      />
      <Group>
        <FileButton
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(f) => {
            setFile(f);
            runCheck(f, replace);
          }}
        >
          {(props) => (
            <Button {...props} leftSection={<IconFileSpreadsheet size={16} />} loading={check.pending}>
              Choose a file
            </Button>
          )}
        </FileButton>
        <Button component="a" href="/admin/exhibitor-template.csv" variant="subtle" size="sm">
          Download a template
        </Button>
      </Group>
      {file && check.error ? <Alert color="red">{check.error}</Alert> : null}
    </Stack>
  );
}
