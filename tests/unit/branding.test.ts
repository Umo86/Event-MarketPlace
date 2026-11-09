import { describe, expect, it } from 'vitest';
import {
  brandCss,
  brandCssVariables,
  checkAccentColour,
  checkMainColour,
  contrastRatio,
  DARK_TEXT,
  DEFAULT_PLATFORM_BRANDING,
  normaliseHex,
  resolveBranding,
  WHITE,
} from '@/lib/branding';

describe('colour contrast', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 is the classic lightest grey that passes on white.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });

  it('reads hex values loosely and refuses anything else', () => {
    expect(normaliseHex('#ABC')).toBe('#aabbcc');
    expect(normaliseHex(' 0B5D57 ')).toBe('#0b5d57');
    expect(normaliseHex('red')).toBeNull();
    expect(normaliseHex('#12345')).toBeNull();
    expect(normaliseHex('url(x)')).toBeNull();
  });
});

describe('the main colour', () => {
  it('passes when white text on it is readable', () => {
    expect(checkMainColour('#0b5d57')).toEqual({ ok: true, colour: '#0b5d57' });
  });

  it('is refused when too light, with a darker version that passes', () => {
    const r = checkMainColour('#7fd1c7');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/too hard to read/);
    expect(r.suggestion).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(r.suggestion!, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(checkMainColour(r.suggestion).ok).toBe(true);
  });

  it('says how to write a colour when it is not one', () => {
    const r = checkMainColour('blue');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.suggestion).toBeNull();
  });
});

describe('the accent colour', () => {
  it('passes when dark text on it is readable', () => {
    expect(checkAccentColour('#f4d35e').ok).toBe(true);
  });

  it('is refused when too dark, with a lighter version that passes', () => {
    const r = checkAccentColour('#5a3d8a');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(contrastRatio(r.suggestion!, DARK_TEXT)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('resolving a storefront’s branding', () => {
  it('falls back to the platform defaults, named Event MarketPlace', () => {
    const r = resolveBranding({ name: 'UKCW London 2027', branding: {} }, DEFAULT_PLATFORM_BRANDING);
    expect(r.marketplaceName).toBe('Event MarketPlace');
    expect(r.primaryColor).toBe(DEFAULT_PLATFORM_BRANDING.primaryColor);
    expect(r.emailSenderName).toBe('Event MarketPlace');
  });

  it('uses the show’s own values, and ignores a stored colour that would fail', () => {
    const r = resolveBranding(
      { name: 'UKCW', branding: { marketplaceName: 'UKCW London Marketplace', primaryColor: '#ffff00', accentColor: '#f4d35e', emailSenderName: 'UKCW Orders' } },
      DEFAULT_PLATFORM_BRANDING,
    );
    expect(r.marketplaceName).toBe('UKCW London Marketplace');
    expect(r.primaryColor).toBe(DEFAULT_PLATFORM_BRANDING.primaryColor);
    expect(r.accentColor).toBe('#f4d35e');
    expect(r.emailSenderName).toBe('UKCW Orders');
  });
});

describe('the CSS built from branding', () => {
  it('contains only checked hex colours', () => {
    const css = brandCss('#0b5d57', '#f4d35e');
    expect(css.startsWith(':root{')).toBe(true);
    expect(css).toContain('--mantine-primary-color-filled:#0b5d57');
    expect(css).not.toMatch(/[<>"'\\]/);
    expect(css.match(/[{}]/g)).toEqual(['{', '}']);
  });

  it('refuses anything that is not a hex colour', () => {
    expect(() => brandCssVariables('red;}body{display:none', '#f4d35e')).toThrow();
    expect(() => brandCss('#0b5d57', 'url(https://evil.example)')).toThrow();
  });
});
