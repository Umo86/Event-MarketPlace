'use server';

import { z } from 'zod';
import { runAction, type ActionResult } from '@/server/actions';
import { asUser } from '@/server/authz';
import { getCurrentAuth } from '@/server/auth/current';
import { setPassword } from '@/server/auth/login';

export async function setPasswordAction(input: unknown): Promise<ActionResult> {
  return runAction({
    action: 'account.manage',
    schema: z.object({ password: z.string().min(1, 'Enter a password.').max(200) }),
    input,
    work: async (actor, data) => {
      const auth = await getCurrentAuth();
      await setPassword(asUser(actor), data.password, auth?.session ?? null);
    },
    message: 'Password saved. Your other devices were signed out.',
  });
}
