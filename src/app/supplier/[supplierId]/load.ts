import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { requireActor } from '@/server/auth/current';
import { getSupplierForMember } from '@/server/services/suppliers';
import { AppError } from '@/server/errors';

/** The supplier for this panel, checked once per request. Anyone not on its team gets "not found". */
export const loadSupplier = cache(async (supplierId: string) => {
  const { actor } = await requireActor('supplier.view', { supplierId });
  const found = await getSupplierForMember(actor, supplierId).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });
  return { actor, ...found };
});
