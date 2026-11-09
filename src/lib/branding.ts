/**
 * Show branding: the stored shape, the contrast rules and the CSS variables built from it.
 * Pure, so the server (which applies branding) and the admin's live preview use the same rules.
 * See DECISIONS.md, "Branding".
 */

export type ShowBranding = {
  /** e.g. "UKCW London 2027 Marketplace". Used in the header, browser tab, emails and PDFs. */
  marketplaceName?: string | null;
  logoFileId?: string | null;
  /** A light version of the logo, for dark backgrounds. */
  logoLightFileId?: string | null;
  bannerFileId?: string | null;
  faviconFileId?: string | null;
  /** Buttons, links and the header. Must reach 4.5:1 against white. */
  primaryColor?: string | null;
  /** Highlights behind dark text. Must reach 4.5:1 against dark text. */
  accentColor?: string | null;
  /** The name emails come from, e.g. "UKCW London Marketplace". */
  emailSenderName?: string | null;
};

/** What a super admin sets for shows without their own branding. */
export type PlatformBranding = {
  marketplaceName: string;
  primaryColor: string;
  accentColor: string;
  logoFileId?: string | null;
};

export const PLATFORM_NAME = 'Event MarketPlace';

export const DEFAULT_PLATFORM_BRANDING: PlatformBranding = {
  marketplaceName: PLATFORM_NAME,
  primaryColor: '#0b5d57',
  accentColor: '#f4d35e',
};

/** The dark text colour the accent colour is checked against. */
export const DARK_TEXT = '#1a1b1e';
export const WHITE = '#ffffff';
/** WCAG AA for normal text. */
export const MIN_CONTRAST = 4.5;

const HEX = /^#[0-9a-f]{6}$/;

/** "#ABC", "abc123" or " #AbC123 " become "#aabbcc" / "#abc123"; anything else is null. */
export function normaliseHex(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  let v = value.trim().toLowerCase();
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return HEX.test(v) ? v : null;
}

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG 2 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

/**
 * The nearest colour of the same hue that passes against `against`: darker for a colour used
 * with white, lighter for one used behind dark text.
 */
export function nearestPassing(hex: string, against: string, direction: 'darker' | 'lighter'): string {
  const [h, s, l] = toHsl(toRgb(hex));
  for (let step = 1; step <= 100; step++) {
    const nl = direction === 'darker' ? l - step / 100 : l + step / 100;
    if (nl < 0 || nl > 1) break;
    const candidate = toHex(fromHsl([h, s, nl]));
    if (contrastRatio(candidate, against) >= MIN_CONTRAST) return candidate;
  }
  return direction === 'darker' ? '#000000' : '#ffffff';
}

export type ColourCheck = { ok: true; colour: string } | { ok: false; message: string; suggestion: string | null };

const ratioText = (r: number) => `${(Math.floor(r * 10) / 10).toFixed(1)}:1`;

/** The main colour carries white text (buttons) and is used for links on white. */
export function checkMainColour(value: string | null | undefined): ColourCheck {
  const colour = normaliseHex(value);
  if (!colour) return { ok: false, message: 'Enter a colour as a hex value, such as #0b5d57.', suggestion: null };
  const ratio = contrastRatio(colour, WHITE);
  if (ratio >= MIN_CONTRAST) return { ok: true, colour };
  const suggestion = nearestPassing(colour, WHITE, 'darker');
  return {
    ok: false,
    message: `White text on this colour is too hard to read (${ratioText(ratio)}, it needs 4.5:1). Try ${suggestion}, a darker version.`,
    suggestion,
  };
}

/** The accent colour sits behind dark text (highlights and badges). */
export function checkAccentColour(value: string | null | undefined): ColourCheck {
  const colour = normaliseHex(value);
  if (!colour) return { ok: false, message: 'Enter a colour as a hex value, such as #f4d35e.', suggestion: null };
  const ratio = contrastRatio(colour, DARK_TEXT);
  if (ratio >= MIN_CONTRAST) return { ok: true, colour };
  const suggestion = nearestPassing(colour, DARK_TEXT, 'lighter');
  return {
    ok: false,
    message: `Dark text on this colour is too hard to read (${ratioText(ratio)}, it needs 4.5:1). Try ${suggestion}, a lighter version.`,
    suggestion,
  };
}

function mix(hex: string, with_: string, amount: number): string {
  const a = toRgb(hex);
  const b = toRgb(with_);
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as Rgb);
}

/** What a storefront looks like: the show's own values, or the platform's where it has none. */
export type ResolvedBranding = {
  marketplaceName: string;
  primaryColor: string;
  accentColor: string;
  logoFileId: string | null;
  logoLightFileId: string | null;
  bannerFileId: string | null;
  faviconFileId: string | null;
  emailSenderName: string;
};

export function resolveBranding(show: { name: string; branding: ShowBranding }, platform: PlatformBranding): ResolvedBranding {
  const b = show.branding ?? {};
  // Stored colours were checked when saved; they are checked again here so nothing else can reach a page.
  const primary = checkMainColour(b.primaryColor);
  const accent = checkAccentColour(b.accentColor);
  const platformPrimary = checkMainColour(platform.primaryColor);
  const platformAccent = checkAccentColour(platform.accentColor);
  const name = b.marketplaceName?.trim() || platform.marketplaceName?.trim() || PLATFORM_NAME;
  return {
    marketplaceName: name,
    primaryColor: primary.ok ? primary.colour : platformPrimary.ok ? platformPrimary.colour : DEFAULT_PLATFORM_BRANDING.primaryColor,
    accentColor: accent.ok ? accent.colour : platformAccent.ok ? platformAccent.colour : DEFAULT_PLATFORM_BRANDING.accentColor,
    logoFileId: b.logoFileId ?? platform.logoFileId ?? null,
    logoLightFileId: b.logoLightFileId ?? null,
    bannerFileId: b.bannerFileId ?? null,
    faviconFileId: b.faviconFileId ?? null,
    emailSenderName: b.emailSenderName?.trim() || name,
  };
}

/**
 * CSS custom properties for a storefront, from checked hex values only. Mantine's primary colour
 * variables are set too, so buttons, links and focus rings take the show's colour.
 */
export function brandCssVariables(primary: string, accent: string): Record<string, string> {
  if (!isHex(primary) || !isHex(accent)) throw new Error('Brand colours must be checked hex values');
  const shades = [0.92, 0.84, 0.7, 0.55, 0.4, 0.2, 0, -0.15, -0.3, -0.45];
  const vars: Record<string, string> = {
    '--brand-main': primary,
    '--brand-main-hover': mix(primary, '#000000', 0.15),
    '--brand-on-main': WHITE,
    '--brand-main-tint': mix(primary, WHITE, 0.9),
    '--brand-accent': accent,
    '--brand-on-accent': DARK_TEXT,
    '--mantine-primary-color-filled': primary,
    '--mantine-primary-color-filled-hover': mix(primary, '#000000', 0.15),
    '--mantine-primary-color-light': mix(primary, WHITE, 0.9),
    '--mantine-primary-color-light-hover': mix(primary, WHITE, 0.82),
    '--mantine-primary-color-light-color': primary,
    '--mantine-primary-color-contrast': WHITE,
    '--mantine-color-anchor': primary,
  };
  shades.forEach((amount, i) => {
    vars[`--mantine-primary-color-${i}`] = amount >= 0 ? mix(primary, WHITE, amount) : mix(primary, '#000000', -amount);
  });
  return vars;
}

/**
 * The variables as one CSS rule. Every value is a checked hex colour, so nothing else can get in.
 * The second selector matches Mantine's own colour-scheme rule, so these win over its defaults.
 */
export function brandCss(primary: string, accent: string): string {
  const vars = brandCssVariables(primary, accent);
  const body = Object.entries(vars)
    .filter(([k, v]) => /^--[a-z0-9-]+$/.test(k) && isHex(v))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return `:root,:root[data-mantine-color-scheme]{${body}}`;
}
