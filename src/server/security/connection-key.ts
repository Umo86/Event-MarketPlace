import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Each show's key for BluePrint and Billie (pure; see DECISIONS.md, "Signing in"). Adapted from
 * Billie's BluePrint connection.
 *
 * A key is "em_", a 12-character key id, "_", then 43 random characters. It sends the exhibitor
 * list (as a bearer token) and signs exhibitors in with a JWT (HS256) whose secret is the SHA-256
 * of "event-marketplace-sign-in:" followed by the key. We keep only the key's SHA-256 and, encrypted,
 * that signing secret.
 */
const KEY = /^em_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;
const ID_LETTERS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newConnectionKey(): { key: string; keyId: string } {
  let keyId = '';
  for (let i = 0; i < 12; i++) keyId += ID_LETTERS[randomInt(ID_LETTERS.length)];
  return { key: `em_${keyId}_${randomBytes(32).toString('base64url')}`, keyId };
}

/** The key id of a well-formed key, or null. */
export function keyIdOf(key: string): string | null {
  return KEY.exec(key.trim())?.[1] ?? null;
}

export function keyHashOf(key: string): string {
  return createHash('sha256').update(key.trim(), 'utf8').digest('hex');
}

/** What sign-ins are signed with (hex), made from the key. */
export function signingKeyOf(key: string): string {
  return createHash('sha256').update(`event-marketplace-sign-in:${key.trim()}`, 'utf8').digest('hex');
}

/** Compares a presented key with the stored hash without leaking timing. */
export function keyMatches(key: string, storedHash: string): boolean {
  const a = Buffer.from(keyHashOf(key), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Sign-in tokens

/** A sign-in link is made when the exhibitor presses the button, so it needs only a short life. */
export const TOKEN_MAX_SECONDS = 15 * 60;
const SKEW_SECONDS = 60;
const MAX_TOKEN_LENGTH = 2048;
const PART = /^[A-Za-z0-9_-]+$/;
export const TOKEN_ISSUERS = ['blueprint', 'billie'] as const;
export const TOKEN_AUDIENCE = 'event-marketplace';

export type TokenProblem = 'malformed' | 'unknown_key' | 'bad_signature' | 'wrong_audience' | 'expired' | 'not_yet' | 'too_long' | 'used' | 'not_listed';

export type ReadToken = { ok: true; keyId: string; email: string; exp: number; jti: string; issuer: string } | { ok: false; reason: TokenProblem };

function decode(part: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parts(token: string): [string, string, string] | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const p = token.trim().split('.');
  return p.length === 3 && p.every((x) => PART.test(x)) ? (p as [string, string, string]) : null;
}

/** The key id a token says it was signed with, before anything is checked (to find the show's key). */
export function tokenKeyId(token: string): string | null {
  const p = parts(token);
  const header = p ? decode(p[0]) : null;
  const kid = header?.kid;
  return typeof kid === 'string' && /^[a-z0-9]{12}$/.test(kid) ? kid : null;
}

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks a token with the show's signing key: the signature first, then what it says. */
export function readToken(token: string, signingKeyHex: string, now = Date.now()): ReadToken {
  const p = parts(token);
  const header = p ? decode(p[0]) : null;
  const keyId = tokenKeyId(token);
  // Only HS256: never "none", never a key the token chooses.
  if (!p || !header || header.alg !== 'HS256' || !keyId) return { ok: false, reason: 'malformed' };
  if (header.typ !== undefined && header.typ !== 'JWT') return { ok: false, reason: 'malformed' };
  const expected = createHmac('sha256', Buffer.from(signingKeyHex, 'hex')).update(`${p[0]}.${p[1]}`).digest();
  const given = Buffer.from(p[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad_signature' };

  const claims = decode(p[1]);
  if (!claims) return { ok: false, reason: 'malformed' };
  const aud = claims.aud;
  if (!(aud === TOKEN_AUDIENCE || (Array.isArray(aud) && aud.includes(TOKEN_AUDIENCE)))) return { ok: false, reason: 'wrong_audience' };
  if (typeof claims.iss !== 'string' || !(TOKEN_ISSUERS as readonly string[]).includes(claims.iss)) return { ok: false, reason: 'wrong_audience' };
  const { iat, exp, nbf } = claims;
  if (!isTime(iat) || !isTime(exp) || exp - iat > TOKEN_MAX_SECONDS) return { ok: false, reason: 'too_long' };
  const secs = now / 1000;
  if (iat > secs + SKEW_SECONDS || (isTime(nbf) && nbf > secs + SKEW_SECONDS)) return { ok: false, reason: 'not_yet' };
  if (exp <= secs - SKEW_SECONDS) return { ok: false, reason: 'expired' };
  const jti = typeof claims.jti === 'string' ? claims.jti.trim() : '';
  if (!jti || jti.length > 100) return { ok: false, reason: 'malformed' };
  const sub = typeof claims.sub === 'string' ? claims.sub.trim().toLowerCase() : '';
  if (!EMAIL.test(sub) || sub.length > 254) return { ok: false, reason: 'malformed' };
  return { ok: true, keyId, email: sub, exp, jti, issuer: claims.iss };
}

/** A sign-in token, made the way BluePrint and Billie make it (for tests and the guide's example). */
export function signToken(key: string, email: string, opts: { now?: number; seconds?: number; claims?: Record<string, unknown> } = {}): string {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT', kid: keyIdOf(key) });
  const body = b64({
    iss: 'blueprint',
    aud: TOKEN_AUDIENCE,
    sub: email,
    iat: now,
    exp: now + (opts.seconds ?? 300),
    jti: randomBytes(12).toString('base64url'),
    ...opts.claims,
  });
  const sig = createHmac('sha256', Buffer.from(signingKeyOf(key), 'hex')).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** What the sign-in page says when a link didn't work. */
export function tokenProblemText(reason: TokenProblem): string {
  switch (reason) {
    case 'expired':
      return 'This sign-in link has run out. Go back to the exhibitor manual and open the marketplace again, or sign in with an emailed code.';
    case 'used':
      return 'This sign-in link has already been used. Go back to the exhibitor manual and open the marketplace again, or sign in with an emailed code.';
    case 'not_listed':
    case 'unknown_key':
    case 'bad_signature':
      return 'We couldn’t sign you in with this link. Sign in with an emailed code instead, or contact the show team.';
    default:
      return 'This sign-in link isn’t working. Sign in with an emailed code instead.';
  }
}
