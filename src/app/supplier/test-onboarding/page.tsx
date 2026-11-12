import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, Stack, Text } from '@mantine/core';
import { requireSignedIn } from '@/server/auth/current';
import { simulatedAccountSupplier } from '@/server/services/connect';
import { AppError } from '@/server/errors';
import { FinishTestOnboarding } from './finish-button';

export const metadata: Metadata = { title: 'Test Stripe set-up' };

/**
 * Stands in for Stripe's own set-up pages on a developer's computer (no Stripe key). It doesn't
 * exist anywhere else: on a live site, or once a Stripe key is set, it is "not found".
 */
export default async function TestOnboarding({ searchParams }: PageProps<'/supplier/test-onboarding'>) {
  const actor = await requireSignedIn();
  const sp = await searchParams;
  const account = typeof sp.account === 'string' ? sp.account : '';
  const supplier = await simulatedAccountSupplier(actor, account).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });
  return (
    <Stack maw={560} gap="lg">
      <h1 className="page-title">Test Stripe set-up</h1>
      <Alert color="orange" title="Payment simulator">
        This page stands in for Stripe on a developer’s computer. No money moves and nothing is sent to Stripe. On the live site, {supplier.name} gives their business and bank details to Stripe on Stripe’s own pages.
      </Alert>
      <Text fz="sm">Finishing here marks this test account as able to take payments, so {supplier.name} becomes Ready to sell.</Text>
      <FinishTestOnboarding account={account} />
    </Stack>
  );
}
