/** Web addresses the app itself uses, so no show can take them. */
export const RESERVED_SLUGS = new Set([
  'admin', 'supplier', 'suppliers', 'api', 'files', 'dev', 'sign-in', 'sign-out', 'signin', 'signout', 'invite',
  'account', 'two-factor', 'two-factor-setup', 'start', '_next', 'static', 'public', 'favicon.ico', 'robots.txt',
  'sitemap.xml', 'icon.svg', 'apple-icon.png', 'help', 'about', 'terms', 'privacy', 'stripe', 'webhooks', 'pay', 'test',
]);

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

/** "UK Construction Week London 2027" → "uk-construction-week-london-2027". */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** Why a web address can't be used, or null when it can. */
export function slugProblem(slug: string): string | null {
  if (!SLUG_PATTERN.test(slug)) return 'Use lower case letters, numbers and hyphens, starting and ending with a letter or number.';
  if (RESERVED_SLUGS.has(slug)) return 'That address is used by the marketplace itself. Choose another.';
  return null;
}
