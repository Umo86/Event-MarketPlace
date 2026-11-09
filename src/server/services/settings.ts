import 'server-only';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type DbLike } from '../db/client';
import { platformSettings } from '../db/schema';
import { checkAccentColour, checkMainColour, DEFAULT_PLATFORM_BRANDING, PLATFORM_NAME, type PlatformBranding } from '@/lib/branding';

/**
 * Platform settings a super admin controls. Each has a fixed shape and a default, so a missing or
 * damaged value never breaks a page.
 */
const SETTINGS = {
  branding: {
    schema: z.object({
      marketplaceName: z.string().trim().min(1).max(80),
      primaryColor: z.string(),
      accentColor: z.string(),
      logoFileId: z.string().uuid().nullish(),
    }),
    fallback: DEFAULT_PLATFORM_BRANDING as PlatformBranding,
  },
  /**
   * How commission is treated for VAT. Left for Umit's accountant to decide (DECISIONS.md, "Money");
   * nothing charges VAT on commission until they set it.
   */
  commissionVat: {
    schema: z.object({ chargeVat: z.boolean(), rateBps: z.number().int().min(0).max(10_000) }),
    fallback: { chargeVat: false, rateBps: 2000 },
  },
} as const;

type Settings = typeof SETTINGS;
export type SettingKey = keyof Settings;
export type SettingValue<K extends SettingKey> = Settings[K]['fallback'];

export async function getSetting<K extends SettingKey>(key: K, db?: DbLike): Promise<SettingValue<K>> {
  const d = db ?? (await getDb());
  const [row] = await d.select().from(platformSettings).where(eq(platformSettings.key, key)).limit(1);
  const parsed = SETTINGS[key].schema.safeParse(row?.value);
  return (parsed.success ? parsed.data : SETTINGS[key].fallback) as SettingValue<K>;
}

export async function getPlatformBranding(db?: DbLike): Promise<PlatformBranding> {
  const b = await getSetting('branding', db);
  const main = checkMainColour(b.primaryColor);
  const accent = checkAccentColour(b.accentColor);
  return {
    marketplaceName: b.marketplaceName || PLATFORM_NAME,
    primaryColor: main.ok ? main.colour : DEFAULT_PLATFORM_BRANDING.primaryColor,
    accentColor: accent.ok ? accent.colour : DEFAULT_PLATFORM_BRANDING.accentColor,
    logoFileId: b.logoFileId ?? null,
  };
}

/** Writes a setting (callers check permission and write the audit row in the same transaction). */
export async function putSetting<K extends SettingKey>(tx: DbLike, key: K, value: SettingValue<K>, userId: string | null) {
  const parsed = SETTINGS[key].schema.parse(value);
  await tx
    .insert(platformSettings)
    .values({ key, value: parsed, updatedBy: userId })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value: parsed, updatedBy: userId, updatedAt: new Date() } });
}
