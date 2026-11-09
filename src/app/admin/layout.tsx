import { AdminShell } from '@/components/admin-shell';
import { requireSignedIn } from '@/server/auth/current';

export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const actor = await requireSignedIn();
  return <AdminShell user={{ name: actor.name, email: actor.email, isSuperAdmin: actor.isSuperAdmin }}>{children}</AdminShell>;
}
