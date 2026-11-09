import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/admin-shell';
import { requireSignedIn } from '@/server/auth/current';
import { staffShowIds } from '@/server/authz';
import { navFor } from '@/server/nav';

/** Media10 staff only: anyone else (a supplier) goes to their own place. */
export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const actor = await requireSignedIn();
  const shows = await staffShowIds(actor);
  if (shows !== null && !shows.length && !actor.isSuperAdmin) redirect('/start');
  return (
    <AdminShell user={{ name: actor.name, email: actor.email }} nav={await navFor(actor)} home="/admin">
      {children}
    </AdminShell>
  );
}
