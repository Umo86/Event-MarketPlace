import 'server-only';
import { lt } from 'drizzle-orm';
import { getDb } from '../db/client';
import { invitations, loginCodes, sessions } from '../db/schema';
import { purgeOldRateLimits } from '../security/rate-limit';
import { purgeStorefrontSessions } from './storefront-auth';

/** Once a day: codes, sign-ins and counters that can no longer be used. */
export async function purgeExpired(now = new Date()) {
  const db = await getDb();
  const dayAgo = new Date(now.getTime() - 86_400_000);
  await db.delete(loginCodes).where(lt(loginCodes.expiresAt, dayAgo));
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date(now.getTime() - 30 * 86_400_000)));
  await db.delete(invitations).where(lt(invitations.expiresAt, new Date(now.getTime() - 90 * 86_400_000)));
  await purgeOldRateLimits();
  await purgeStorefrontSessions(now);
}
