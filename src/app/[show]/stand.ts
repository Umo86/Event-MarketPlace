import 'server-only';
import { asExhibitor } from '@/server/authz';
import { myStands } from '@/server/services/storefront-auth';
import type { Actor } from '@/server/auth/actor';

/** The stand being ordered for: the one in the address if it's theirs, else their first. */
export async function pickStand(actor: Actor, wanted: string | string[] | undefined) {
  const stands = await myStands(asExhibitor(actor));
  const id = typeof wanted === 'string' ? wanted : undefined;
  const stand = stands.find((s) => s.standId === id) ?? stands[0] ?? null;
  return { stands, stand };
}
