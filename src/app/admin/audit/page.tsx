import type { Metadata } from 'next';
import { Badge, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { requireActor } from '@/server/auth/current';
import { auditEntries } from '@/server/services/platform';
import { dateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Audit log' };

const WHO: Record<string, string> = { user: 'Person', exhibitor: 'Exhibitor', system: 'System', api: 'BluePrint', anonymous: 'Not signed in' };

export default async function AuditPage() {
  const { actor } = await requireActor('platform.audit.view');
  const rows = await auditEntries(actor);
  return (
    <>
      <PageHeader title="Audit log" description="Every change and sign-in, newest first. Entries can’t be changed or deleted." />
      <Panel>
        <TableScrollContainer minWidth={760}>
          <Table verticalSpacing="xs" fz="sm" striped>
            <TableThead>
              <TableTr>
                <TableTh>When</TableTh>
                <TableTh>Who</TableTh>
                <TableTh>What</TableTh>
                <TableTh>Show</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {rows.map(({ entry, showName }) => (
                <TableTr key={entry.id}>
                  <TableTd style={{ whiteSpace: 'nowrap' }}>{dateTime(entry.at)}</TableTd>
                  <TableTd>
                    <Badge color="gray" mr={6}>
                      {WHO[entry.actorType] ?? entry.actorType}
                    </Badge>
                    {entry.actorEmail ?? ''}
                  </TableTd>
                  <TableTd>
                    {entry.summary}
                    <Text fz="xs" c="dimmed">
                      {entry.action}
                    </Text>
                  </TableTd>
                  <TableTd>{showName ?? ''}</TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </TableScrollContainer>
      </Panel>
    </>
  );
}
