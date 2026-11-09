import 'server-only';
import sanitizeHtml from 'sanitize-html';

/**
 * Cleans an uploaded SVG logo down to drawing only (DECISIONS.md, "Images"): a fixed list of shape,
 * text and gradient tags and their presentation attributes. No scripts, event handlers, styles,
 * embedded HTML, external links or entities survive. SVGs are also served with a strict
 * Content-Security-Policy, so this is the first of two locks.
 */
const TAGS = [
  'svg', 'g', 'defs', 'title', 'desc', 'symbol', 'use',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask',
];

const PRESENTATION = [
  'id', 'class', 'transform', 'opacity', 'visibility', 'display',
  'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'clip-path', 'mask',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing',
];

const ATTRS: Record<string, string[]> = {
  svg: ['xmlns', 'xmlns:xlink', 'version', 'viewBox', 'width', 'height', 'preserveAspectRatio', 'x', 'y', ...PRESENTATION],
  '*': PRESENTATION,
  use: ['href', 'xlink:href', 'x', 'y', 'width', 'height'],
  symbol: ['viewBox', 'preserveAspectRatio'],
  path: ['d', 'pathLength'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
  text: ['x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust'],
  tspan: ['x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust'],
  linearGradient: ['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href', 'xlink:href'],
  radialGradient: ['cx', 'cy', 'r', 'fx', 'fy', 'fr', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href', 'xlink:href'],
  stop: ['offset', 'stop-color', 'stop-opacity'],
  clipPath: ['clipPathUnits'],
  mask: ['maskUnits', 'maskContentUnits', 'x', 'y', 'width', 'height'],
};

export class UnsafeSvgError extends Error {
  constructor(message = 'This SVG could not be used. Save it again as a plain SVG, or upload a PNG instead.') {
    super(message);
    this.name = 'UnsafeSvgError';
  }
}

/** Returns the cleaned SVG, or throws UnsafeSvgError when what is left is not a usable drawing. */
export function sanitiseSvg(input: string): string {
  if (input.length > 1024 * 1024) throw new UnsafeSvgError('This SVG is too large. Keep logos under 1 MB.');
  // Entities can expand into anything (and fetch files): refuse them outright.
  if (/<!ENTITY/i.test(input)) throw new UnsafeSvgError();
  const withoutProlog = input
    .replace(/^﻿/, '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const cleaned = sanitizeHtml(withoutProlog, {
    allowedTags: TAGS,
    allowedAttributes: ATTRS,
    // Only same-document links (#id) are allowed; checked again below.
    allowedSchemes: [],
    allowedSchemesAppliedToAttributes: ['href', 'xlink:href'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'foreignObject', 'iframe', 'object', 'embed', 'textarea', 'noscript'],
    parser: { xmlMode: true, lowerCaseTags: false, lowerCaseAttributeNames: false, recognizeSelfClosing: true },
  }).trim();

  if (!/^<svg[\s>]/.test(cleaned)) throw new UnsafeSvgError();
  // Links may only point inside the drawing, and paints may only use the drawing's own gradients.
  if (/(?:^|\s)(?:xlink:)?href\s*=\s*["'](?!#)/i.test(cleaned)) throw new UnsafeSvgError();
  if (/url\(\s*["']?(?!#)/i.test(cleaned)) throw new UnsafeSvgError();
  if (/javascript:|data:/i.test(cleaned)) throw new UnsafeSvgError();
  return cleaned;
}
