'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction, type ActionResult } from '@/server/actions';
import { asUser } from '@/server/authz';
import { categorySchema, createCategory, deleteCategory, moveCategory, updateCategory } from '@/server/services/categories';

/** A show's categories and which supplier serves each. Show admins only (`categories.manage`). */

const ids = { showId: z.string().uuid() };
const done = (showId: string) => {
  revalidatePath(`/admin/shows/${showId}/categories`);
  revalidatePath('/', 'layout');
};

export async function createCategoryAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'categories.manage',
    schema: categorySchema.safeExtend(ids),
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, { showId, ...d }) => {
      await createCategory(asUser(actor), showId, d);
      done(showId);
    },
    message: 'Category added.',
  });
}

export async function updateCategoryAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'categories.manage',
    schema: categorySchema.safeExtend({ ...ids, categoryId: z.string().uuid() }),
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, { showId, categoryId, ...d }) => {
      await updateCategory(asUser(actor), showId, categoryId, d);
      done(showId);
    },
    message: 'Saved.',
  });
}

export async function deleteCategoryAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'categories.manage',
    schema: z.object({ ...ids, categoryId: z.string().uuid() }),
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, d) => {
      await deleteCategory(asUser(actor), d.showId, d.categoryId);
      done(d.showId);
    },
    message: 'Category removed.',
  });
}

export async function moveCategoryAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'categories.manage',
    schema: z.object({ ...ids, categoryId: z.string().uuid(), direction: z.enum(['up', 'down']) }),
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, d) => {
      await moveCategory(asUser(actor), d.showId, d.categoryId, d.direction);
      done(d.showId);
    },
  });
}
