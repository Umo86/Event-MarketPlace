import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { getCurrentAuth, twoFactorJustTurnedOn } from '@/server/auth/current';
import { twoFactorOn } from '@/server/env';
import { EnrollForm } from './enroll-form';

export const metadata: Metadata = { title: 'Set up two-factor sign-in' };

export default async function TwoFactorSetupPage() {
  const auth = await getCurrentAuth();
  if (!auth) redirect('/sign-in');
  if (!twoFactorOn()) redirect('/start');
  // Just turned on: stay here so the person can save their recovery codes.
  if (auth.user.totpEnabledAt && !twoFactorJustTurnedOn(auth.user)) redirect('/start');
  return (
    <AuthCard
      title="Set up two-factor sign-in"
      subtitle={
        auth.isStaff
          ? 'Because you can see exhibitor and payment details, your account needs a second step at sign-in.'
          : 'A second step at sign-in, with an app on your phone, keeps your account safe even if someone gets into your email.'
      }
    >
      <EnrollForm />
    </AuthCard>
  );
}
