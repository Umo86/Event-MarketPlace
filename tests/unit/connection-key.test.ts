import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { keyIdOf, keyMatches, keyHashOf, newConnectionKey, readToken, signingKeyOf, signToken, tokenKeyId, TOKEN_MAX_SECONDS } from '@/server/security/connection-key';

const { key } = newConnectionKey();
const signing = signingKeyOf(key);

describe('connection keys', () => {
  it('have a recognisable shape and id', () => {
    expect(key).toMatch(/^em_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    expect(keyIdOf(key)).toBe(key.slice(3, 15));
    expect(keyIdOf('bp_abc')).toBeNull();
  });

  it('match only their own hash', () => {
    expect(keyMatches(key, keyHashOf(key))).toBe(true);
    expect(keyMatches(newConnectionKey().key, keyHashOf(key))).toBe(false);
  });
});

describe('sign-in tokens', () => {
  it('accept a token made the way BluePrint makes it', () => {
    const t = signToken(key, 'Sam@Example.com');
    const r = readToken(t, signing);
    expect(r).toMatchObject({ ok: true, email: 'sam@example.com', keyId: keyIdOf(key), issuer: 'blueprint' });
    expect(tokenKeyId(t)).toBe(keyIdOf(key));
  });

  it('accept Billie as the issuer', () => {
    expect(readToken(signToken(key, 'a@b.co', { claims: { iss: 'billie' } }), signing)).toMatchObject({ ok: true, issuer: 'billie' });
  });

  it('refuse a token signed with another key', () => {
    const other = newConnectionKey().key;
    expect(readToken(signToken(other, 'a@b.co'), signing)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuse a tampered email', () => {
    const [h, b, s] = signToken(key, 'a@b.co').split('.');
    const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: 'boss@b.co' })).toString('base64url');
    expect(readToken(`${h}.${forged}.${s}`, signing)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuse "none" and any other algorithm', () => {
    const [, b] = signToken(key, 'a@b.co').split('.');
    const none = Buffer.from(JSON.stringify({ alg: 'none', kid: keyIdOf(key) })).toString('base64url');
    expect(readToken(`${none}.${b}.x`, signing)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuse tokens that last longer than 15 minutes', () => {
    expect(readToken(signToken(key, 'a@b.co', { seconds: TOKEN_MAX_SECONDS + 1 }), signing)).toEqual({ ok: false, reason: 'too_long' });
  });

  it('refuse expired tokens, allowing a minute for clocks', () => {
    const made = Date.now() - 10 * 60_000;
    const t = signToken(key, 'a@b.co', { now: made, seconds: 300 });
    expect(readToken(t, signing)).toEqual({ ok: false, reason: 'expired' });
    const justOver = signToken(key, 'a@b.co', { now: Date.now() - 330_000, seconds: 300 });
    expect(readToken(justOver, signing).ok).toBe(true);
  });

  it('refuse tokens from the future', () => {
    expect(readToken(signToken(key, 'a@b.co', { now: Date.now() + 10 * 60_000 }), signing)).toEqual({ ok: false, reason: 'not_yet' });
  });

  it('refuse the wrong audience or issuer', () => {
    expect(readToken(signToken(key, 'a@b.co', { claims: { aud: 'billie' } }), signing)).toEqual({ ok: false, reason: 'wrong_audience' });
    expect(readToken(signToken(key, 'a@b.co', { claims: { iss: 'someone' } }), signing)).toEqual({ ok: false, reason: 'wrong_audience' });
  });

  it('need a token id, so each one can be used once', () => {
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const head = b64({ alg: 'HS256', kid: keyIdOf(key) });
    const body = b64({ iss: 'blueprint', aud: 'event-marketplace', sub: 'a@b.co', iat: now, exp: now + 60 });
    const sig = createHmac('sha256', Buffer.from(signing, 'hex')).update(`${head}.${body}`).digest('base64url');
    expect(readToken(`${head}.${body}.${sig}`, signing)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuse rubbish', () => {
    expect(readToken('not-a-token', signing)).toEqual({ ok: false, reason: 'malformed' });
    expect(readToken('a'.repeat(5000), signing)).toEqual({ ok: false, reason: 'malformed' });
  });
});
