'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction, type ActionResult } from '@/server/actions';
import { asUser } from '@/server/authz';
import { approveProduct, rejectProduct, saveProduct, setCommission, setDefaultCommission, setProductArchived, setSupplierCommission } from '@/server/services/catalogue';

/**
 * Catalogue actions. Suppliers edit their own products (`supplier.catalogue.edit`); show admins
 * edit Media10's own services (`categories.manage`), approve changes (`products.approve`) and set
 * commission (`commission.manage`). Super admins set a supplier's and the platform's commission.
 */

const productForm = z.object({
  showId: z.string().uuid(),
  supplierId: z.string().uuid(),
  productId: z.string().uuid().nullish(),
  removeImage: z.boolean().default(false),
  image: z.instanceof(File).nullable(),
  fields: z.record(z.string(), z.unknown()),
});

function readProductForm(form: FormData) {
  const image = form.get('image');
  let fields: Record<string, unknown> = {};
  try {
    fields = JSON.parse(String(form.get('fields') ?? '{}'));
  } catch {
    fields = {};
  }
  return {
    showId: form.get('showId'),
    supplierId: form.get('supplierId'),
    productId: form.get('productId') || null,
    removeImage: form.get('removeImage') === '1',
    image: image instanceof File && image.size ? image : null,
    fields,
  };
}

async function save(via: 'supplier' | 'organiser', form: FormData): Promise<ActionResult<{ id: string; status: string; waiting: boolean }>> {
  return runAction({
    action: via === 'supplier' ? 'supplier.catalogue.edit' : 'categories.manage',
    schema: productForm,
    input: readProductForm(form),
    target: (d) => (via === 'supplier' ? { supplierId: d.supplierId } : { showId: d.showId }),
    work: async (actor, d) => {
      const image = d.image ? { bytes: new Uint8Array(await d.image.arrayBuffer()), name: d.image.name } : null;
      const row = await saveProduct(asUser(actor), { showId: d.showId, supplierId: d.supplierId, productId: d.productId, via }, d.fields as never, image, { removeImage: d.removeImage });
      revalidatePath('/', 'layout');
      return { id: row.id, status: row.status, waiting: row.status === 'pending' || Boolean(row.pendingChange) };
    },
  });
}

export async function saveSupplierProductAction(form: FormData) {
  return save('supplier', form);
}

export async function saveOrganiserProductAction(form: FormData) {
  return save('organiser', form);
}

export async function archiveProductAction(input: unknown): Promise<ActionResult> {
  const schema = z.object({ showId: z.string().uuid(), supplierId: z.string().uuid(), productId: z.string().uuid(), archived: z.boolean(), via: z.enum(['supplier', 'organiser']) });
  const parsed = schema.safeParse(input);
  const via = parsed.success ? parsed.data.via : 'supplier';
  return runAction({
    action: via === 'supplier' ? 'supplier.catalogue.edit' : 'categories.manage',
    schema,
    input,
    target: (d) => (d.via === 'supplier' ? { supplierId: d.supplierId } : { showId: d.showId }),
    work: async (actor, d) => {
      await setProductArchived(asUser(actor), d, d.archived);
      revalidatePath('/', 'layout');
    },
    message: 'Saved.',
  });
}

export async function approveProductAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'products.approve',
    schema: z.object({ showId: z.string().uuid(), productId: z.string().uuid() }),
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, d) => {
      await approveProduct(asUser(actor), d.showId, d.productId);
      revalidatePath('/', 'layout');
    },
    message: 'Approved. Exhibitors see it now.',
  });
}

export async function rejectProductAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'products.approve',
    schema: z.object({ showId: z.string().uuid(), productId: z.string().uuid(), reason: z.string().max(500) }),
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, d) => {
      await rejectProduct(asUser(actor), d.showId, d.productId, d.reason);
      revalidatePath('/', 'layout');
    },
    message: 'Sent back to the supplier with your reason.',
  });
}

const commission = z.object({ type: z.enum(['percent', 'fixed']).nullable(), value: z.string().max(12) });

export async function setShowCommissionAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'commission.manage',
    schema: z.object({ showId: z.string().uuid(), level: z.enum(['show', 'category', 'product']), id: z.string().uuid().nullish(), commission }),
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, d) => {
      const on = d.level === 'show' ? ({ level: 'show' } as const) : { level: d.level, id: d.id ?? '' };
      await setCommission(asUser(actor), d.showId, on, d.commission);
      revalidatePath(`/admin/shows/${d.showId}`, 'layout');
    },
    message: 'Commission saved.',
  });
}

export async function setSupplierCommissionAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'suppliers.manage',
    schema: z.object({ supplierId: z.string().uuid(), commission }),
    input,
    work: async (actor, d) => {
      await setSupplierCommission(asUser(actor), d.supplierId, d.commission);
      revalidatePath(`/admin/suppliers/${d.supplierId}`);
    },
    message: 'Commission saved.',
  });
}

export async function setDefaultCommissionAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'platform.settings.edit',
    schema: z.object({ commission }),
    input,
    work: async (actor, d) => {
      await setDefaultCommission(asUser(actor), d.commission);
      revalidatePath('/admin/platform');
    },
    message: 'Default commission saved.',
  });
}
