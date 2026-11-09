import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { requireActor } from '@/server/auth/current';
import { NewShowForm } from './new-show-form';

export const metadata: Metadata = { title: 'New show' };

export default async function NewShowPage() {
  await requireActor('shows.create');
  return (
    <>
      <PageHeader eyebrow="Shows" title="New show" description="A show is one dated event, such as UK Construction Week London 2027. It starts as a draft that only the team can see." />
      <Panel>
        <NewShowForm />
      </Panel>
    </>
  );
}
