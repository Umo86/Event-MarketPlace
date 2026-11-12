'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Checkbox, FileInput, Group, MultiSelect, Paper, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPhoto, IconPlus } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { money, percentFromBps } from '@/lib/format';
import { poundsInput } from '@/lib/pricing';
import { archiveProductAction, saveOrganiserProductAction, saveSupplierProductAction } from '@/app/catalogue-actions';

export type EditorProduct = {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  code: string | null;
  description: string | null;
  imageFileId: string | null;
  unit: string;
  pricePence: number;
  earlyPricePence: number | null;
  latePricePence: number | null;
  vatRateBps: number;
  stockLimit: number | null;
  standTypeKeys: string[];
  status: 'pending' | 'live' | 'rejected' | 'archived';
  pendingChange: { name: string; description: string | null; imageFileId: string | null; pricePence: number; earlyPricePence: number | null; latePricePence: number | null; vatRateBps: number } | null;
  rejectionReason: string | null;
};

type Option = { id: string; name: string };
type StandType = { key: string; name: string };

const STATUS: Record<EditorProduct['status'], { label: string; colour: string }> = {
  pending: { label: 'Waiting for approval', colour: 'yellow' },
  live: { label: 'On sale', colour: 'green' },
  rejected: { label: 'Not approved', colour: 'red' },
  archived: { label: 'Off sale', colour: 'gray' },
};

const VAT_OPTIONS = [
  { value: '2000', label: '20% (standard)' },
  { value: '500', label: '5% (reduced)' },
  { value: '0', label: '0% (zero-rated)' },
];

type Values = { categoryId: string; name: string; code: string; description: string; unit: string; price: string; earlyPrice: string; latePrice: string; vatRateBps: string; stockLimit: string; standTypeKeys: string[] };

function valuesOf(p: EditorProduct | null, categories: Option[]): Values {
  // What the supplier last asked for, so editing a waiting change carries on from it.
  const c = p?.pendingChange ?? p;
  return {
    categoryId: p?.categoryId ?? categories[0]?.id ?? '',
    name: c?.name ?? '',
    code: p?.code ?? '',
    description: c?.description ?? '',
    unit: p?.unit ?? 'each',
    price: poundsInput(c?.pricePence),
    earlyPrice: poundsInput(c?.earlyPricePence),
    latePrice: poundsInput(c?.latePricePence),
    vatRateBps: String(c?.vatRateBps ?? 2000),
    stockLimit: p?.stockLimit === null || p?.stockLimit === undefined ? '' : String(p.stockLimit),
    standTypeKeys: p?.standTypeKeys ?? [],
  };
}

function ProductForm({ product, categories, standTypes, showId, supplierId, via, onDone }: { product: EditorProduct | null; categories: Option[]; standTypes: StandType[]; showId: string; supplierId: string; via: 'supplier' | 'organiser'; onDone: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<Values>(valuesOf(product, categories));
  const [image, setImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.currentTarget.value });
  const hasImage = Boolean(product?.pendingChange?.imageFileId ?? product?.imageFileId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const form = new FormData();
    form.set('showId', showId);
    form.set('supplierId', supplierId);
    if (product) form.set('productId', product.id);
    form.set('fields', JSON.stringify({ ...v, vatRateBps: Number(v.vatRateBps) }));
    if (image) form.set('image', image);
    if (removeImage) form.set('removeImage', '1');
    setBusy(true);
    const res = await (via === 'supplier' ? saveSupplierProductAction(form) : saveOrganiserProductAction(form));
    setBusy(false);
    if (res.ok) {
      notifications.show({ color: 'green', message: res.data?.waiting ? 'Saved. A show admin will check it before exhibitors see it.' : 'Saved. Exhibitors see it now.' });
      router.refresh();
      onDone();
    } else {
      setErrors(res.fieldErrors ?? {});
      notifications.show({ color: 'red', title: 'Not saved', message: res.error });
    }
  }

  return (
    <Paper withBorder radius="md" p="lg" style={{ borderColor: 'var(--em-line)' }}>
      <form onSubmit={submit}>
        <Stack gap="md">
          <Text fw={650}>{product ? `Change ${product.name}` : 'Add a product'}</Text>
          {via === 'supplier' && product?.status === 'live' ? (
            <Alert color="blue">Changes to the name, description, picture, prices or VAT wait for a show admin to approve them. Until then exhibitors see what’s on sale now.</Alert>
          ) : null}
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select label="Category" data={categories.map((c) => ({ value: c.id, label: c.name }))} value={v.categoryId} onChange={(x) => setV({ ...v, categoryId: x ?? '' })} allowDeselect={false} error={errors.categoryId} />
            <TextInput label="Name" required value={v.name} onChange={set('name')} error={errors.name} />
            <TextInput label="Your product code (optional)" value={v.code} onChange={set('code')} error={errors.code} />
            <TextInput label="Sold per" description="Such as each, per m², per day." value={v.unit} onChange={set('unit')} error={errors.unit} />
          </SimpleGrid>
          <Textarea label="Description (optional)" autosize minRows={2} value={v.description} onChange={set('description')} error={errors.description} />
          <SimpleGrid cols={{ base: 1, sm: 4 }}>
            <TextInput label="Price before VAT (£)" required inputMode="decimal" value={v.price} onChange={set('price')} error={errors.price} />
            <TextInput label="Early-bird price (£)" description="Optional" inputMode="decimal" value={v.earlyPrice} onChange={set('earlyPrice')} error={errors.earlyPrice} />
            <TextInput label="Late price (£)" description="Optional" inputMode="decimal" value={v.latePrice} onChange={set('latePrice')} error={errors.latePrice} />
            <Select label="VAT" data={VAT_OPTIONS} value={v.vatRateBps} onChange={(x) => setV({ ...v, vatRateBps: x ?? '2000' })} allowDeselect={false} error={errors.vatRateBps} />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="How many you can supply (optional)" description="Leave empty for no limit." inputMode="numeric" value={v.stockLimit} onChange={set('stockLimit')} error={errors.stockLimit} />
            <MultiSelect
              label="Stand types that can order it"
              description="Leave empty for every stand type."
              data={standTypes.map((t) => ({ value: t.key, label: t.name }))}
              value={v.standTypeKeys}
              onChange={(x) => setV({ ...v, standTypeKeys: x })}
              clearable
              error={errors.standTypeKeys}
            />
          </SimpleGrid>
          <Group align="flex-end">
            <FileInput label="Picture (optional)" description="PNG or JPEG, up to 2 MB." accept="image/png,image/jpeg" value={image} onChange={setImage} clearable leftSection={<IconPhoto size={16} aria-hidden />} style={{ minWidth: 260 }} />
            {hasImage && !image ? <Checkbox label="Remove the current picture" checked={removeImage} onChange={(e) => setRemoveImage(e.currentTarget.checked)} /> : null}
          </Group>
          <Group>
            <Button type="submit" loading={busy}>
              {product ? 'Save' : via === 'supplier' ? 'Add and send for approval' : 'Add'}
            </Button>
            <Button variant="default" onClick={onDone}>
              Cancel
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

function prices(p: { pricePence: number; earlyPricePence: number | null; latePricePence: number | null; vatRateBps: number }) {
  return [money(p.pricePence), p.earlyPricePence !== null ? `early-bird ${money(p.earlyPricePence)}` : null, p.latePricePence !== null ? `late ${money(p.latePricePence)}` : null, `+ VAT ${percentFromBps(p.vatRateBps)}`].filter(Boolean).join(' · ');
}

/** The product list with add, change and off-sale, for a supplier's catalogue or Media10's own services. */
export function ProductEditor({ products, categories, standTypes, showId, supplierId, via, canEdit }: { products: EditorProduct[]; categories: Option[]; standTypes: StandType[]; showId: string; supplierId: string; via: 'supplier' | 'organiser'; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const archive = useAction(archiveProductAction);
  const typeName = new Map(standTypes.map((t) => [t.key, t.name]));
  return (
    <Stack gap="md">
      {canEdit && editing === null ? (
        <Group>
          <Button leftSection={<IconPlus size={16} aria-hidden />} onClick={() => setEditing('new')}>
            Add a product
          </Button>
        </Group>
      ) : null}
      {editing === 'new' ? <ProductForm product={null} categories={categories} standTypes={standTypes} showId={showId} supplierId={supplierId} via={via} onDone={() => setEditing(null)} /> : null}
      {products.length === 0 && editing !== 'new' ? (
        <Text fz="sm" c="dimmed">
          No products yet.
        </Text>
      ) : null}
      {products.map((p) =>
        editing === p.id ? (
          <ProductForm key={p.id} product={p} categories={categories} standTypes={standTypes} showId={showId} supplierId={supplierId} via={via} onDone={() => setEditing(null)} />
        ) : (
          <Paper key={p.id} withBorder radius="md" p="md" style={{ borderColor: 'var(--em-line)' }} data-testid={`product-${p.name}`}>
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Group align="flex-start" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                {p.imageFileId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/files/${p.imageFileId}`} alt="" width={64} height={64} style={{ objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                ) : null}
                <div style={{ minWidth: 0 }}>
                  <Group gap="xs">
                    <Text fw={650}>{p.name}</Text>
                    <Badge color={STATUS[p.status].colour}>{STATUS[p.status].label}</Badge>
                    {p.pendingChange ? <Badge color="yellow">Change waiting for approval</Badge> : null}
                  </Group>
                  <Text fz="sm" c="dimmed">
                    {p.categoryName} · {prices(p)} {p.unit !== 'each' ? `per ${p.unit}` : 'each'}
                  </Text>
                  <Text fz="xs" c="dimmed">
                    {p.stockLimit !== null ? `Up to ${p.stockLimit}` : 'No limit'} · {p.standTypeKeys.length ? p.standTypeKeys.map((k) => typeName.get(k) ?? k).join(', ') : 'Every stand type'}
                    {p.code ? ` · code ${p.code}` : ''}
                  </Text>
                  {p.pendingChange ? (
                    <Text fz="xs" c="dimmed">
                      Asked for: {p.pendingChange.name} · {prices(p.pendingChange)}
                    </Text>
                  ) : null}
                  {p.rejectionReason ? (
                    <Text fz="sm" c="red.8" mt={4}>
                      {p.status === 'rejected' ? 'Not approved' : 'Last change not approved'}: {p.rejectionReason}
                    </Text>
                  ) : null}
                </div>
              </Group>
              {canEdit ? (
                <Group gap="xs">
                  {p.status !== 'archived' ? (
                    <Button size="xs" variant="default" onClick={() => setEditing(p.id)}>
                      Change
                    </Button>
                  ) : null}
                  <Button size="xs" variant="subtle" color={p.status === 'archived' ? undefined : 'red'} loading={archive.pending} onClick={() => archive.run({ showId, supplierId, productId: p.id, archived: p.status !== 'archived', via })}>
                    {p.status === 'archived' ? 'Put back on sale' : 'Take off sale'}
                  </Button>
                </Group>
              ) : null}
            </Group>
          </Paper>
        ),
      )}
    </Stack>
  );
}
