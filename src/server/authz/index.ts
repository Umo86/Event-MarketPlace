import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb, type DbLike } from '../db/client';
import { SHOW_PERMISSIONS, showStaff, shows, supplierUsers, type ShowPermission, type ShowRole, type SupplierRole } from '../db/schema';
import { forbidden, notFound, readOnly } from '../errors';
import type { Actor, ExhibitorActor, UserActor } from '../auth/actor';

/**
 * The only place that decides who may do what (CLAUDE.md, "Permissions"). Every server action
 * names one of these actions and goes through runAction(); pages call requireActor(). Nothing else
 * checks roles.
 *
 * Who holds what:
 * - Super admins: everything.
 * - Show admins: everything for their shows.
 * - Show team members: viewing their shows, plus the rights a show admin gives them.
 * - Exhibitors: their own show's storefront only.
 */

type Rule =
  /** Super admins only. */
  | { scope: 'platform' }
  /** Anyone signed in with an account, for their own account. */
  | { scope: 'self' }
  /** Show staff: `role: 'show_admin'` for admins only, or a right a team member can be given. */
  | { scope: 'show'; role: 'show_admin' }
  | { scope: 'show'; role: 'any' }
  | { scope: 'show'; permission: ShowPermission }
  /** People who sign in for a supplier: `owner` for the owner only. */
  | { scope: 'supplier'; role: 'any' | 'owner' }
  /** Exhibitors signed in to that show's storefront. */
  | { scope: 'storefront' };

export const ACTIONS = {
  // Platform
  'platform.settings.edit': { scope: 'platform' },
  'platform.audit.view': { scope: 'platform' },
  'platform.admins.manage': { scope: 'platform' },
  'shows.create': { scope: 'platform' },
  /** Suppliers work across shows, so adding them and their logins is for super admins. */
  'suppliers.view': { scope: 'platform' },
  'suppliers.manage': { scope: 'platform' },
  /** The list of shows someone can open: everyone with an account sees their own. */
  'shows.list': { scope: 'self' },

  // Own account
  'account.manage': { scope: 'self' },

  // A show
  'show.view': { scope: 'show', role: 'any' },
  'show.settings.edit': { scope: 'show', role: 'show_admin' },
  'show.branding.edit': { scope: 'show', role: 'show_admin' },
  'show.team.manage': { scope: 'show', role: 'show_admin' },
  'show.connection.manage': { scope: 'show', role: 'show_admin' },
  'show.audit.view': { scope: 'show', role: 'show_admin' },
  'exhibitors.view': { scope: 'show', permission: 'exhibitors' },
  'exhibitors.manage': { scope: 'show', permission: 'exhibitors' },
  'orders.view': { scope: 'show', permission: 'orders' },
  'orders.refund': { scope: 'show', permission: 'refunds' },
  'reports.view': { scope: 'show', permission: 'reports' },

  // A supplier's own panel
  'supplier.view': { scope: 'supplier', role: 'any' },
  'supplier.manage': { scope: 'supplier', role: 'owner' },

  // The storefront
  'storefront.browse': { scope: 'storefront' },
  'storefront.order': { scope: 'storefront' },
} as const satisfies Record<string, Rule>;

export type ActionName = keyof typeof ACTIONS;

export type Target = { showId?: string; supplierId?: string };

export type ShowAccess = { role: 'super_admin' | ShowRole; permissions: ReadonlySet<ShowPermission> };

const ALL: ReadonlySet<ShowPermission> = new Set(SHOW_PERMISSIONS);

/** What a person may do in a show, or null when they have no part in it. */
export async function showAccess(actor: Actor, showId: string, db?: DbLike): Promise<ShowAccess | null> {
  if (actor.kind !== 'user') return null;
  if (actor.isSuperAdmin && !actor.readOnly) return { role: 'super_admin', permissions: ALL };
  const d = db ?? (await getDb());
  const [row] = await d
    .select({ role: showStaff.role, permissions: showStaff.permissions })
    .from(showStaff)
    .where(and(eq(showStaff.showId, showId), eq(showStaff.userId, actor.userId)))
    .limit(1);
  if (!row) return null;
  if (row.role === 'show_admin') return { role: 'show_admin', permissions: ALL };
  return { role: 'show_team', permissions: new Set(row.permissions.filter((p) => ALL.has(p))) };
}

/** Shows a person works on (null means every show: a super admin). */
export async function staffShowIds(actor: Actor, db?: DbLike): Promise<string[] | null> {
  if (actor.kind !== 'user') return [];
  if (actor.isSuperAdmin && !actor.readOnly) return null;
  const d = db ?? (await getDb());
  const rows = await d.select({ showId: showStaff.showId }).from(showStaff).where(eq(showStaff.userId, actor.userId));
  return rows.map((r) => r.showId);
}

/** Pure part of the rules, given what a person holds in the show (tested row by row). */
export function allowedInShow(rule: Rule & { scope: 'show' }, access: ShowAccess): boolean {
  if ('role' in rule) return rule.role === 'any' || access.role === 'super_admin' || access.role === 'show_admin';
  return access.permissions.has(rule.permission);
}

export type Grant = { actor: Actor; access: ShowAccess | null; supplierRole?: SupplierRole };

/**
 * Throws unless the actor may do the action (for the show in `target`, where the action needs one).
 * People with no part in a show get "not found", so they cannot learn which shows exist. Changes are
 * refused while viewing as someone else.
 */
export async function authorize(actor: Actor | null, action: ActionName, target: Target = {}, opts: { write?: boolean; db?: DbLike } = {}): Promise<Grant> {
  if (!actor) throw forbidden('Sign in to do that.');
  const rule: Rule = ACTIONS[action];
  if (actor.kind === 'system') return { actor, access: null };
  if (opts.write && actor.kind === 'user' && actor.readOnly) throw readOnly();

  switch (rule.scope) {
    case 'platform':
      if (actor.kind !== 'user' || !actor.isSuperAdmin || actor.readOnly) throw notFound();
      return { actor, access: null };
    case 'self':
      if (actor.kind !== 'user') throw forbidden();
      return { actor, access: null };
    case 'supplier': {
      if (!target.supplierId) throw new Error(`${action} needs a supplier`);
      if (actor.kind !== 'user' || actor.readOnly) throw notFound();
      const d = opts.db ?? (await getDb());
      const [member] = await d
        .select({ role: supplierUsers.role })
        .from(supplierUsers)
        .where(and(eq(supplierUsers.supplierId, target.supplierId), eq(supplierUsers.userId, actor.userId)))
        .limit(1);
      if (!member) throw notFound();
      if (rule.role === 'owner' && member.role !== 'owner') throw forbidden();
      return { actor, access: null, supplierRole: member.role };
    }
    case 'storefront': {
      // Only someone signed in to this show's own storefront.
      if (actor.kind !== 'exhibitor' || !target.showId || actor.showId !== target.showId) throw notFound();
      return { actor, access: null };
    }
    case 'show': {
      if (!target.showId) throw new Error(`${action} needs a show`);
      if (actor.kind !== 'user') throw notFound();
      const d = opts.db ?? (await getDb());
      const [exists] = await d.select({ id: shows.id }).from(shows).where(eq(shows.id, target.showId)).limit(1);
      if (!exists) throw notFound();
      const access = await showAccess(actor, target.showId, d);
      if (!access) throw notFound();
      if (!allowedInShow(rule, access)) throw forbidden();
      return { actor, access };
    }
  }
}

/** True or false instead of throwing: for deciding what to show on a page, never for guarding a change. */
export async function can(actor: Actor | null, action: ActionName, target: Target = {}, db?: DbLike): Promise<boolean> {
  try {
    await authorize(actor, action, target, { db });
    return true;
  } catch {
    return false;
  }
}

export function asUser(actor: Actor): UserActor {
  if (actor.kind !== 'user') throw forbidden();
  return actor;
}

export function asExhibitor(actor: Actor): ExhibitorActor {
  if (actor.kind !== 'exhibitor') throw forbidden();
  return actor;
}

/** Suppliers someone signs in for. */
export async function supplierIdsFor(actor: Actor, db?: DbLike): Promise<string[]> {
  if (actor.kind !== 'user') return [];
  const d = db ?? (await getDb());
  const rows = await d.select({ id: supplierUsers.supplierId }).from(supplierUsers).where(eq(supplierUsers.userId, actor.userId));
  return rows.map((r) => r.id);
}

/** Which kind of sign-in an action needs: an account, or a storefront sign-in. */
export function audienceOf(action: ActionName): 'user' | 'exhibitor' {
  return ACTIONS[action].scope === 'storefront' ? 'exhibitor' : 'user';
}
