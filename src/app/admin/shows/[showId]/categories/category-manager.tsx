'use client';

import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { SUPPLIER_STATUS_COLOUR, SUPPLIER_STATUS_LABEL, type SupplierStatus } from '@/lib/supplier-status';
import { createCategoryAction, deleteCategoryAction, moveCategoryAction, updateCategoryAction } from './actions';

type SupplierOption = { id: string; name: string; kind: 'company' | 'organiser'; status: SupplierStatus };
type Category = { id: string; name: string; description: string | null; supplier: { id: string; name: string; status: SupplierStatus } | null };

const NONE = 'none';

function supplierData(suppliers: SupplierOption[]) {
  return [
    { value: NONE, label: 'No supplier yet' },
    ...suppliers.map((s) => ({ value: s.id, label: `${s.name}${s.kind === 'organiser' ? ' (Media10’s own services)' : ''} · ${SUPPLIER_STATUS_LABEL[s.status]}` })),
  ];
}

function CategoryRow({ showId, c, suppliers, first, last, canManage }: { showId: string; c: Category; suppliers: SupplierOption[]; first: boolean; last: boolean; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description ?? '');
  const [confirming, setConfirming] = useState(false);
  const save = useAction(updateCategoryAction, { onSuccess: () => setEditing(false) });
  const remove = useAction(deleteCategoryAction);
  const move = useAction(moveCategoryAction);
  const current = { name: c.name, description: c.description, supplierId: c.supplier?.id ?? null };

  return (
    <Paper withBorder radius="md" p="md" style={{ borderColor: 'var(--em-line)' }} data-testid={`category-${c.name}`}>
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <div style={{ minWidth: 220, flex: 1 }}>
          {editing ? (
            <Stack gap="xs">
              <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} error={save.fieldErrors.name} />
              <TextInput label="Description (optional)" value={description} onChange={(e) => setDescription(e.currentTarget.value)} error={save.fieldErrors.description} />
              <Group gap="xs">
                <Button size="xs" loading={save.pending} onClick={() => save.run({ showId, categoryId: c.id, ...current, name, description })}>
                  Save
                </Button>
                <Button size="xs" variant="default" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </Group>
            </Stack>
          ) : (
            <>
              <Text fw={650}>{c.name}</Text>
              {c.description ? (
                <Text fz="sm" c="dimmed">
                  {c.description}
                </Text>
              ) : null}
            </>
          )}
        </div>
        <div style={{ minWidth: 260, flex: 1 }}>
          {canManage ? (
            <Select
              label="Supplier"
              aria-label={`Supplier for ${c.name}`}
              data={supplierData(suppliers)}
              value={c.supplier?.id ?? NONE}
              allowDeselect={false}
              disabled={save.pending}
              onChange={(v) => save.run({ showId, categoryId: c.id, ...current, supplierId: v && v !== NONE ? v : null })}
              searchable
            />
          ) : (
            <Text fz="sm">{c.supplier ? c.supplier.name : 'No supplier yet'}</Text>
          )}
          {c.supplier ? (
            <Group gap={6} mt={6}>
              <Badge color={SUPPLIER_STATUS_COLOUR[c.supplier.status]} size="sm">
                {SUPPLIER_STATUS_LABEL[c.supplier.status]}
              </Badge>
              <Text fz="xs" c="dimmed">
                {c.supplier.status === 'ready' ? 'Shown to exhibitors.' : 'Hidden from exhibitors until the supplier is ready to sell.'}
              </Text>
            </Group>
          ) : (
            <Text fz="xs" c="dimmed" mt={6}>
              Hidden from exhibitors until it has a supplier.
            </Text>
          )}
        </div>
        {canManage ? (
          <Group gap={4}>
            <ActionIcon variant="subtle" color="gray" aria-label={`Move ${c.name} up`} disabled={first || move.pending} onClick={() => move.run({ showId, categoryId: c.id, direction: 'up' })}>
              <IconArrowUp size={16} />
            </ActionIcon>
            <ActionIcon variant="subtle" color="gray" aria-label={`Move ${c.name} down`} disabled={last || move.pending} onClick={() => move.run({ showId, categoryId: c.id, direction: 'down' })}>
              <IconArrowDown size={16} />
            </ActionIcon>
            {!editing ? (
              <Button size="xs" variant="subtle" onClick={() => setEditing(true)}>
                Rename
              </Button>
            ) : null}
            {confirming ? (
              <>
                <Button size="xs" color="red" loading={remove.pending} onClick={() => remove.run({ showId, categoryId: c.id })}>
                  Remove it
                </Button>
                <Button size="xs" variant="default" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button size="xs" variant="subtle" color="red" onClick={() => setConfirming(true)}>
                Remove
              </Button>
            )}
          </Group>
        ) : null}
      </Group>
    </Paper>
  );
}

export function CategoryManager({ showId, categories, suppliers, canManage }: { showId: string; categories: Category[]; suppliers: SupplierOption[]; canManage: boolean }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [supplierId, setSupplierId] = useState<string>(NONE);
  const create = useAction(createCategoryAction, {
    onSuccess: () => {
      setName('');
      setDescription('');
      setSupplierId(NONE);
    },
  });
  return (
    <Stack gap="md">
      {categories.length ? (
        categories.map((c, i) => <CategoryRow key={c.id} showId={showId} c={c} suppliers={suppliers} first={i === 0} last={i === categories.length - 1} canManage={canManage} />)
      ) : (
        <Text fz="sm" c="dimmed">
          No categories yet.{canManage ? ' Add the first, such as Electrics or Furniture.' : ''}
        </Text>
      )}
      {canManage ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.run({ showId, name, description, supplierId: supplierId !== NONE ? supplierId : null });
          }}
        >
          <Stack gap="sm" mt="md">
            <Text fw={650}>Add a category</Text>
            <SimpleGrid cols={{ base: 1, md: 3 }}>
              <TextInput label="Name" placeholder="Electrics" required value={name} onChange={(e) => setName(e.currentTarget.value)} error={create.fieldErrors.name} />
              <TextInput label="Description (optional)" placeholder="Sockets, lighting and power" value={description} onChange={(e) => setDescription(e.currentTarget.value)} error={create.fieldErrors.description} />
              <Select label="Supplier" data={supplierData(suppliers)} value={supplierId} allowDeselect={false} onChange={(v) => setSupplierId(v ?? NONE)} searchable error={create.fieldErrors.supplierId} />
            </SimpleGrid>
            <Group>
              <Button type="submit" loading={create.pending}>
                Add category
              </Button>
            </Group>
          </Stack>
        </form>
      ) : null}
    </Stack>
  );
}
