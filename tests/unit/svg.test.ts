import { describe, expect, it } from 'vitest';
import { sanitiseSvg, UnsafeSvgError } from '@/server/security/svg';

const logo = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><defs><linearGradient id="g"><stop offset="0" stop-color="#0b5d57"/></linearGradient></defs><rect width="100" height="40" fill="url(#g)"/><text x="10" y="25" font-family="Arial">UKCW</text></svg>`;

describe('cleaning SVG logos', () => {
  it('keeps a plain drawing, gradients included', () => {
    const out = sanitiseSvg(logo);
    expect(out.startsWith('<svg')).toBe(true);
    expect(out).toContain('linearGradient');
    expect(out).toContain('viewBox="0 0 100 40"');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('UKCW');
  });

  it('removes scripts, event handlers, styles and embedded HTML', () => {
    const out = sanitiseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><style>*{background:url(https://x)}</style><foreignObject><iframe src="https://x"></iframe></foreignObject><rect width="1" height="1" onclick="steal()"/></svg>`,
    );
    expect(out).not.toMatch(/script|onload|onclick|style|foreignObject|iframe|alert/i);
    expect(out).toContain('<rect');
  });

  it('drops or refuses links out of the drawing', () => {
    const out = sanitiseSvg('<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.example/x.svg#a"/></svg>');
    expect(out).not.toMatch(/evil|https/);
    expect(() => sanitiseSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://evil.example/p)"/></svg>')).toThrow(UnsafeSvgError);
  });

  it('refuses javascript links even when hidden in a use', () => {
    const run = () => sanitiseSvg('<svg xmlns="http://www.w3.org/2000/svg"><use href="javascript:alert(1)"/></svg>');
    // Either cleaned away or refused, never kept.
    let out = '';
    try {
      out = run();
    } catch (err) {
      expect(err).toBeInstanceOf(UnsafeSvgError);
      return;
    }
    expect(out).not.toMatch(/javascript/i);
  });

  it('refuses entities', () => {
    expect(() => sanitiseSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>')).toThrow(UnsafeSvgError);
  });

  it('refuses something that is not an SVG at all', () => {
    expect(() => sanitiseSvg('<html><body>hi</body></html>')).toThrow(UnsafeSvgError);
  });
});
