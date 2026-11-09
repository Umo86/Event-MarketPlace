'use client';

import { useMemo, useState } from 'react';
import { Group, Table, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

type Row = { contactId: string; company: string; stand: string; hall: string; standType: string; name: string; email: string; phone: string };

export function ExhibitorTable({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => [r.company, r.stand, r.hall, r.standType, r.name, r.email].some((v) => v.toLowerCase().includes(term)));
  }, [rows, q]);
  if (!rows.length) {
    return <Text c="dimmed">No exhibitors yet. Upload a list below, or connect BluePrint to send it.</Text>;
  }
  return (
    <>
      <Group justify="space-between">
        <TextInput placeholder="Search company, stand or email" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label="Search exhibitors" w={320} maw="100%" />
        <Text fz="sm" c="dimmed">
          {shown.length.toLocaleString('en-GB')} of {rows.length.toLocaleString('en-GB')} contacts
        </Text>
      </Group>
      <Table.ScrollContainer minWidth={760}>
        <Table striped highlightOnHover verticalSpacing="xs" fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Company</Table.Th>
              <Table.Th>Stand</Table.Th>
              <Table.Th>Hall</Table.Th>
              <Table.Th>Stand type</Table.Th>
              <Table.Th>Contact</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Phone</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.slice(0, 500).map((r) => (
              <Table.Tr key={r.contactId}>
                <Table.Td>{r.company}</Table.Td>
                <Table.Td>{r.stand}</Table.Td>
                <Table.Td>{r.hall}</Table.Td>
                <Table.Td>{r.standType}</Table.Td>
                <Table.Td>{r.name}</Table.Td>
                <Table.Td>{r.email}</Table.Td>
                <Table.Td>{r.phone}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {shown.length > 500 ? (
        <Text fz="sm" c="dimmed">
          Showing the first 500. Search to find others.
        </Text>
      ) : null}
    </>
  );
}
