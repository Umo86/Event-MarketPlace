import 'server-only';
import type { NavItem } from '@/components/admin-shell';
import { staffShowIds, supplierIdsFor } from '../authz';
import type { UserActor } from '../auth/actor';

/** The side menu for someone with an account: what they can reach, from what they are. */
export async function navFor(actor: UserActor): Promise<NavItem[]> {
  const [shows, suppliers] = await Promise.all([staffShowIds(actor), supplierIdsFor(actor)]);
  const items: NavItem[] = [];
  const staff = shows === null || shows.length > 0;
  if (staff) items.push({ label: 'Shows', href: '/admin', icon: 'shows', exact: true, also: ['/admin/shows'] });
  if (actor.isSuperAdmin) {
    items.push({ label: 'Suppliers', href: '/admin/suppliers', icon: 'suppliers' });
    items.push({ label: 'Platform settings', href: '/admin/platform', icon: 'settings' });
    items.push({ label: 'Audit log', href: '/admin/audit', icon: 'audit' });
  }
  if (suppliers.length) items.push({ label: suppliers.length > 1 ? 'Your suppliers' : 'Your supplier panel', href: suppliers.length > 1 ? '/supplier' : `/supplier/${suppliers[0]}`, icon: 'home' });
  items.push({ label: 'Your account', href: '/account', icon: 'account' });
  return items;
}
