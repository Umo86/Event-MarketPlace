import { AdminShell } from '@/components/admin-shell';
import { requireSignedIn } from '@/server/auth/current';
import { navFor } from '@/server/nav';

export default async function SupplierLayout({ children }: LayoutProps<'/supplier'>) {
  const actor = await requireSignedIn();
  return (
    <AdminShell user={{ name: actor.name, email: actor.email }} nav={await navFor(actor)}>
      {children}
    </AdminShell>
  );
}
