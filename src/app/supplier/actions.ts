'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction, type ActionResult } from '@/server/actions';
import { asUser } from '@/server/authz';
import { invalid } from '@/server/errors';
import { checkStripeStatus, finishSimulatedOnboarding, startStripeOnboarding } from '@/server/services/connect';
import { addDocument, removeDocument } from '@/server/services/documents';
import { DOCUMENT_KINDS } from '@/server/db/schema';

/**
 * Supplier panel actions. The permission names decide who may do each: owners connect Stripe; anyone
 * on the team may check its status; owners and super admins look after documents.
 */

const supplierOnly = z.object({ supplierId: z.string().uuid() });

/** "Connect with Stripe" and "Carry on with Stripe": returns Stripe's set-up address to go to. */
export async function startStripeAction(input: unknown): Promise<ActionResult<{ url: string }>> {
  return runAction({
    action: 'supplier.manage',
    schema: supplierOnly,
    input,
    target: (d) => ({ supplierId: d.supplierId }),
    work: async (actor, d) => ({ url: await startStripeOnboarding(asUser(actor), d.supplierId) }),
  });
}

export async function checkStripeAction(input: unknown): Promise<ActionResult<{ ready: boolean }>> {
  return runAction({
    action: 'supplier.view',
    schema: supplierOnly,
    input,
    target: (d) => ({ supplierId: d.supplierId }),
    work: async (actor, d) => {
      const view = await checkStripeStatus(asUser(actor), d.supplierId, 'supplier.view');
      revalidatePath(`/supplier/${d.supplierId}`, 'layout');
      return { ready: view.flags.chargesEnabled };
    },
  });
}

/** The local simulator's "Finish set-up". Refused on a live site. */
export async function finishTestOnboardingAction(input: unknown): Promise<ActionResult<{ supplierId: string }>> {
  return runAction({
    action: 'account.manage',
    schema: z.object({ account: z.string().max(60) }),
    input,
    work: async (actor, d) => {
      const supplierId = await finishSimulatedOnboarding(asUser(actor), d.account);
      revalidatePath(`/supplier/${supplierId}`, 'layout');
      return { supplierId };
    },
  });
}

const documentForm = z.object({
  supplierId: z.string().uuid(),
  kind: z.enum(DOCUMENT_KINDS, 'Choose what kind of document this is.'),
  title: z.string().max(120).nullish(),
  expiresOn: z.string().max(10).nullish(),
  file: z.instanceof(File).nullable(),
});

export async function addDocumentAction(form: FormData): Promise<ActionResult> {
  const file = form.get('file');
  const text = (k: string) => (typeof form.get(k) === 'string' ? (form.get(k) as string) : null);
  return runAction({
    action: 'supplier.documents.manage',
    schema: documentForm,
    input: { supplierId: text('supplierId'), kind: text('kind'), title: text('title'), expiresOn: text('expiresOn') || null, file: file instanceof File && file.size ? file : null },
    target: (d) => ({ supplierId: d.supplierId }),
    work: async (actor, d) => {
      if (!d.file) throw invalid('Choose the file to upload.', { file: 'Choose a file.' });
      await addDocument(asUser(actor), d.supplierId, { kind: d.kind, title: d.title, expiresOn: d.expiresOn }, { bytes: new Uint8Array(await d.file.arrayBuffer()), name: d.file.name });
      revalidatePath(`/supplier/${d.supplierId}`, 'layout');
      revalidatePath(`/admin/suppliers/${d.supplierId}`);
    },
    message: 'Document added.',
  });
}

export async function removeDocumentAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'supplier.documents.manage',
    schema: z.object({ supplierId: z.string().uuid(), documentId: z.string().uuid() }),
    input,
    target: (d) => ({ supplierId: d.supplierId }),
    work: async (actor, d) => {
      await removeDocument(asUser(actor), d.supplierId, d.documentId);
      revalidatePath(`/supplier/${d.supplierId}`, 'layout');
      revalidatePath(`/admin/suppliers/${d.supplierId}`);
    },
    message: 'Document removed.',
  });
}
