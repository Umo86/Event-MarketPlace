'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { finishTestOnboardingAction } from '../actions';

export function FinishTestOnboarding({ account }: { account: string }) {
  const router = useRouter();
  const finish = useAction(finishTestOnboardingAction, { onSuccess: (d) => d && router.push(`/supplier/${d.supplierId}/payments?stripe=return`) });
  return (
    <Button onClick={() => finish.run({ account })} loading={finish.pending}>
      Finish test set-up
    </Button>
  );
}
