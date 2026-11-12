'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction, type ActionResult } from '@/server/actions';
import { asUser } from '@/server/authz';
import { createOrganiserSupplier, createSupplier, createSupplierSchema, resetSupplierLogin, setSupplierPaused, updateSupplier, updateSupplierSchema, type NewLogin } from '@/server/services/suppliers';
import { checkStripeStatus } from '@/server/services/connect';

/** Super admins add suppliers and their logins. Nothing is emailed: the login details come back once, to pass on by hand. */

export async function createSupplierAction(input: unknown): Promise<ActionResult<{ id: string; name: string; login: NewLogin }>> {
  return runAction({
    action: 'suppliers.manage',
    schema: createSupplierSchema,
    input,
    work: async (actor, data) => {
      const { supplier, login } = await createSupplier(asUser(actor), data);
      revalidatePath('/admin/suppliers');
      return { id: supplier.id, name: supplier.name, login };
    },
  });
}

export async function updateSupplierAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'suppliers.manage',
    schema: updateSupplierSchema.extend({ supplierId: z.string().uuid() }),
    input,
    work: async (actor, { supplierId, ...data }) => {
      await updateSupplier(asUser(actor), supplierId, data);
      revalidatePath(`/admin/suppliers/${supplierId}`);
    },
    message: 'Saved.',
  });
}

export async function resetSupplierLoginAction(input: unknown): Promise<ActionResult<{ login: NewLogin }>> {
  return runAction({
    action: 'suppliers.manage',
    schema: z.object({ supplierId: z.string().uuid(), userId: z.string().uuid() }),
    input,
    work: async (actor, d) => {
      const login = await resetSupplierLogin(asUser(actor), d.supplierId, d.userId);
      revalidatePath(`/admin/suppliers/${d.supplierId}`);
      return { login };
    },
  });
}

export async function pauseSupplierAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'suppliers.manage',
    schema: z.object({ supplierId: z.string().uuid(), paused: z.boolean(), reason: z.string().max(300).nullish() }),
    input,
    work: async (actor, d) => {
      await setSupplierPaused(asUser(actor), d.supplierId, { paused: d.paused, reason: d.reason });
      revalidatePath(`/admin/suppliers/${d.supplierId}`);
      revalidatePath('/admin/suppliers');
    },
    message: 'Saved.',
  });
}

export async function createOrganiserSupplierAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction({
    action: 'suppliers.manage',
    schema: createSupplierSchema,
    input,
    work: async (actor, data) => {
      const supplier = await createOrganiserSupplier(asUser(actor), data);
      revalidatePath('/admin/suppliers');
      return { id: supplier.id };
    },
  });
}

/** "Check with Stripe" from Media10's page about the supplier. */
export async function adminCheckStripeAction(input: unknown): Promise<ActionResult<{ ready: boolean }>> {
  return runAction({
    action: 'suppliers.manage',
    schema: z.object({ supplierId: z.string().uuid() }),
    input,
    work: async (actor, d) => {
      const view = await checkStripeStatus(asUser(actor), d.supplierId, 'suppliers.manage');
      revalidatePath(`/admin/suppliers/${d.supplierId}`);
      revalidatePath('/admin/suppliers');
      return { ready: view.flags.chargesEnabled };
    },
  });
}
