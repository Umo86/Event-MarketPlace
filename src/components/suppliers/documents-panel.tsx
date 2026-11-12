'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Anchor, Badge, Button, FileInput, Group, Select, SimpleGrid, Stack, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconFileUpload } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { DOCUMENT_KIND_LABEL, DOCUMENT_STATE_COLOUR, DOCUMENT_STATE_LABEL, EXPIRY_REQUIRED, type DocumentKindName, type DocumentState } from '@/lib/documents';
import { addDocumentAction, removeDocumentAction } from '@/app/supplier/actions';

export type DocumentRow = { id: string; kind: DocumentKindName; title: string; fileId: string; fileName: string; expiresOn: string | null; expiryText: string; state: DocumentState; addedOn: string };

const KIND_OPTIONS = (Object.keys(DOCUMENT_KIND_LABEL) as DocumentKindName[]).map((k) => ({ value: k, label: DOCUMENT_KIND_LABEL[k] }));

/** A supplier's documents: the list for everyone allowed to see them, and adding or removing for those who manage them. */
export function DocumentsPanel({ supplierId, docs, canManage }: { supplierId: string; docs: DocumentRow[]; canManage: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<DocumentKindName | null>('public_liability');
  const [title, setTitle] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const remove = useAction(removeDocumentAction, { onSuccess: () => setConfirming(null) });

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const form = new FormData();
    form.set('supplierId', supplierId);
    if (kind) form.set('kind', kind);
    form.set('title', title);
    form.set('expiresOn', expiresOn);
    if (file) form.set('file', file);
    setBusy(true);
    const res = await addDocumentAction(form);
    setBusy(false);
    if (res.ok) {
      notifications.show({ color: 'green', message: 'Document added.' });
      setTitle('');
      setExpiresOn('');
      setFile(null);
      setErrors({});
      router.refresh();
    } else {
      setErrors(res.fieldErrors ?? {});
      notifications.show({ color: 'red', title: 'Not added', message: res.error });
    }
  }

  return (
    <Stack gap="lg">
      {docs.length ? (
        <TableScrollContainer minWidth={640}>
          <Table verticalSpacing="sm" fz="sm" data-testid="documents-table">
            <TableThead>
              <TableTr>
                <TableTh>Document</TableTh>
                <TableTh>Expiry</TableTh>
                <TableTh>Status</TableTh>
                {canManage ? <TableTh /> : null}
              </TableTr>
            </TableThead>
            <TableTbody>
              {docs.map((d) => (
                <TableTr key={d.id}>
                  <TableTd>
                    <Anchor href={`/files/${d.fileId}`} className="text-link" fw={600} target="_blank" rel="noopener">
                      {d.title}
                    </Anchor>
                    <Text fz="xs" c="dimmed">
                      {d.fileName} · added {d.addedOn}
                    </Text>
                  </TableTd>
                  <TableTd>{d.expiryText}</TableTd>
                  <TableTd>
                    <Badge color={DOCUMENT_STATE_COLOUR[d.state]}>{DOCUMENT_STATE_LABEL[d.state]}</Badge>
                  </TableTd>
                  {canManage ? (
                    <TableTd ta="right">
                      {confirming === d.id ? (
                        <Group gap="xs" justify="flex-end">
                          <Button size="xs" color="red" loading={remove.pending} onClick={() => remove.run({ supplierId, documentId: d.id })}>
                            Remove it
                          </Button>
                          <Button size="xs" variant="default" onClick={() => setConfirming(null)}>
                            Keep it
                          </Button>
                        </Group>
                      ) : (
                        <Button size="xs" variant="subtle" color="red" onClick={() => setConfirming(d.id)}>
                          Remove
                        </Button>
                      )}
                    </TableTd>
                  ) : null}
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </TableScrollContainer>
      ) : (
        <Text fz="sm" c="dimmed">
          No documents yet.{canManage ? ' Start with public liability insurance.' : ''}
        </Text>
      )}
      {canManage ? (
        <form ref={formRef} onSubmit={upload}>
          <Stack gap="sm">
            <Text fw={650}>Add a document</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select label="What it is" data={KIND_OPTIONS} value={kind} onChange={(v) => setKind(v as DocumentKindName | null)} allowDeselect={false} error={errors.kind} />
              <TextInput label={kind === 'other' ? 'Name' : 'Name (optional)'} placeholder={kind && kind !== 'other' ? DOCUMENT_KIND_LABEL[kind] : 'Such as Gas Safe certificate'} value={title} onChange={(e) => setTitle(e.currentTarget.value)} error={errors.title} />
              <TextInput
                label={kind && EXPIRY_REQUIRED.has(kind) ? 'Expiry date' : 'Expiry date (if it has one)'}
                description="The last day it’s valid. We remind you 30 days before."
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.currentTarget.value)}
                error={errors.expiresOn}
              />
              <FileInput label="File" description="PDF, PNG or JPEG, up to 5 MB." accept="application/pdf,image/png,image/jpeg" value={file} onChange={setFile} clearable leftSection={<IconFileUpload size={16} aria-hidden />} error={errors.file} />
            </SimpleGrid>
            <Group>
              <Button type="submit" loading={busy}>
                Add document
              </Button>
            </Group>
          </Stack>
        </form>
      ) : null}
    </Stack>
  );
}
