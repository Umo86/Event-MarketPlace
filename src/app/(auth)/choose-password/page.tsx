import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { getCurrentAuth, safeNextPath } from '@/server/auth/current';
import { ChoosePasswordForm } from './choose-password-form';

export const metadata: Metadata = { title: 'Choose your password' };

export default async function ChoosePasswordPage({ searchParams }: PageProps<'/choose-password'>) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null);
  const auth = await getCurrentAuth();
  if (!auth) redirect('/sign-in');
  if (auth.needsSecondFactor) redirect(`/two-factor?next=${encodeURIComponent(next)}`);
  if (!auth.needsPasswordChange) redirect(next);
  return (
    <AuthCard title="Choose your own password" subtitle="You signed in with a one-off password from Media10. Choose one only you know before you carry on.">
      <ChoosePasswordForm next={next} />
    </AuthCard>
  );
}
