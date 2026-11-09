'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction, type ActionResult } from '@/server/actions';
import { asUser } from '@/server/authz';
import { invalid } from '@/server/errors';
import {
  BRANDING_IMAGES,
  brandingSchema,
  createShow,
  createShowSchema,
  makeConnectionKey,
  removeConnectionKey,
  removeTeamMember,
  setBrandingImage,
  showSettingsSchema,
  teamMemberSchema,
  updateBranding,
  updateShowSettings,
  updateTeamMember,
} from '@/server/services/shows';
import { applyUpload, applyUploadSchema, previewUpload, type ListPlan, type ReadRow } from '@/server/services/exhibitors';
import { createInvitation, revokeInvitation } from '@/server/auth/invitations';
import { SHOW_PERMISSIONS, SHOW_ROLES } from '@/server/db/schema';
import { updatePlatformBranding, platformBrandingSchema } from '@/server/services/platform';

/**
 * Server actions for the admin area. Each one names its action for the authz module and goes
 * through runAction(); the services check again underneath.
 */

const showId = z.object({ showId: z.string().uuid() });

export async function createShowAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction({
    action: 'shows.create',
    schema: createShowSchema,
    input,
    work: async (actor, data) => {
      const show = await createShow(asUser(actor), data);
      revalidatePath('/admin');
      return { id: show.id };
    },
    message: 'Show created.',
  });
}

export async function updateShowSettingsAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'show.settings.edit',
    schema: showSettingsSchema,
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, data) => {
      await updateShowSettings(asUser(actor), data);
      revalidatePath(`/admin/shows/${data.showId}`, 'layout');
    },
    message: 'Saved.',
  });
}

export async function updateBrandingAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'show.branding.edit',
    schema: brandingSchema,
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, data) => {
      await updateBranding(asUser(actor), data);
      revalidatePath('/', 'layout');
    },
    message: 'Branding saved. The storefront shows it now.',
  });
}

const imageForm = z.object({
  showId: z.string().uuid(),
  slot: z.enum(Object.keys(BRANDING_IMAGES) as [keyof typeof BRANDING_IMAGES, ...(keyof typeof BRANDING_IMAGES)[]]),
  remove: z.boolean().default(false),
  file: z.instanceof(File).nullable(),
});

export async function brandingImageAction(form: FormData): Promise<ActionResult<{ fileId: string | null }>> {
  const file = form.get('file');
  return runAction({
    action: 'show.branding.edit',
    schema: imageForm,
    input: { showId: form.get('showId'), slot: form.get('slot'), remove: form.get('remove') === '1', file: file instanceof File && file.size ? file : null },
    target: (d) => ({ showId: d.showId }),
    work: async (actor, data) => {
      if (!data.remove && !data.file) throw invalid('Choose a file to upload.');
      const stored = await setBrandingImage(asUser(actor), data.showId, data.slot, data.remove || !data.file ? null : { bytes: new Uint8Array(await data.file.arrayBuffer()), name: data.file.name });
      revalidatePath('/', 'layout');
      return { fileId: stored?.id ?? null };
    },
  });
}

export async function previewUploadAction(form: FormData): Promise<ActionResult<{ rows: ReadRow[]; plan: ListPlan; fileName: string }>> {
  const file = form.get('file');
  return runAction({
    action: 'exhibitors.manage',
    schema: z.object({ showId: z.string().uuid(), replace: z.boolean(), file: z.instanceof(File, { message: 'Choose a file to upload.' }) }),
    input: { showId: form.get('showId'), replace: form.get('replace') === '1', file: file instanceof File && file.size ? file : undefined },
    target: (d) => ({ showId: d.showId }),
    work: async (actor, data) => {
      const { rows, plan } = await previewUpload(actor, data.showId, { name: data.file.name, bytes: new Uint8Array(await data.file.arrayBuffer()) }, { replace: data.replace });
      return { rows, plan, fileName: data.file.name };
    },
  });
}

export async function applyUploadAction(input: unknown): Promise<ActionResult<{ add: number; update: number; same: number; remove: number; skip: number }>> {
  return runAction({
    action: 'exhibitors.manage',
    schema: applyUploadSchema,
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, data) => {
      const counts = await applyUpload(actor, data);
      revalidatePath(`/admin/shows/${data.showId}`, 'layout');
      return counts;
    },
  });
}

export async function makeConnectionKeyAction(input: unknown): Promise<ActionResult<{ key: string }>> {
  return runAction({
    action: 'show.connection.manage',
    schema: showId,
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, data) => {
      const key = await makeConnectionKey(asUser(actor), data.showId);
      revalidatePath(`/admin/shows/${data.showId}`, 'layout');
      return { key };
    },
  });
}

export async function removeConnectionKeyAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'show.connection.manage',
    schema: showId,
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, data) => {
      await removeConnectionKey(asUser(actor), data.showId);
      revalidatePath(`/admin/shows/${data.showId}`, 'layout');
    },
    message: 'Key removed. BluePrint can no longer send the list or sign people in.',
  });
}

export async function inviteTeamAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'show.team.manage',
    schema: z.object({
      showId: z.string().uuid(),
      email: z.string().trim().email('Enter a valid email address.'),
      role: z.enum(SHOW_ROLES),
      permissions: z.array(z.enum(SHOW_PERMISSIONS)).default([]),
    }),
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, data) => {
      await createInvitation(asUser(actor), { kind: 'show_staff', email: data.email, showId: data.showId, role: data.role, permissions: data.role === 'show_admin' ? [] : data.permissions });
      revalidatePath(`/admin/shows/${data.showId}/team`);
    },
    message: 'Invitation sent.',
  });
}

export async function updateTeamMemberAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'show.team.manage',
    schema: teamMemberSchema,
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, data) => {
      await updateTeamMember(asUser(actor), data);
      revalidatePath(`/admin/shows/${data.showId}/team`);
    },
    message: 'Saved.',
  });
}

export async function removeTeamMemberAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'show.team.manage',
    schema: z.object({ showId: z.string().uuid(), userId: z.string().uuid() }),
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, data) => {
      await removeTeamMember(asUser(actor), data.showId, data.userId);
      revalidatePath(`/admin/shows/${data.showId}/team`);
    },
    message: 'Removed from the team.',
  });
}

export async function revokeTeamInviteAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'show.team.manage',
    schema: z.object({ showId: z.string().uuid(), invitationId: z.string().uuid() }),
    input,
    target: (d) => ({ showId: d.showId }),
    work: async (actor, data) => {
      await revokeInvitation(asUser(actor), data.invitationId);
      revalidatePath(`/admin/shows/${data.showId}/team`);
    },
    message: 'Invitation cancelled.',
  });
}

export async function updatePlatformBrandingAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'platform.settings.edit',
    schema: platformBrandingSchema,
    input,
    work: async (actor, data) => {
      await updatePlatformBranding(asUser(actor), data);
      revalidatePath('/', 'layout');
    },
    message: 'Platform defaults saved.',
  });
}

export async function inviteSuperAdminAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'platform.admins.manage',
    schema: z.object({ email: z.string().trim().email('Enter a valid email address.') }),
    input,
    work: async (actor, data) => {
      await createInvitation(asUser(actor), { kind: 'super_admin', email: data.email });
    },
    message: 'Invitation sent.',
  });
}
