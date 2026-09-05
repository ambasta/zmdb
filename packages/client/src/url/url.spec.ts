import {
  encodeClientComponent,
  normalizeClientBaseUrl,
  resolveClientUrl,
  serializeClientQuery,
  stringifyClientScalar,
  substituteClientPath,
} from '@zmdb/client/url';
import { describe, expect, it } from 'vitest';

describe('@zmdb/client URL planning', () => {
  it('resolves relative and absolute base URLs', () => {
    expect(resolveClientUrl('/api/', '/users/1')).toBe('/api/users/1');
    expect(resolveClientUrl('https://api.example.test/v1/', '/users/1')).toBe('https://api.example.test/v1/users/1');
    expect(resolveClientUrl(new URL('https://api.example.test/'), '/users/1')).toBe('https://api.example.test/users/1');
  });

  it('encodes path and query values exactly once', () => {
    const path = substituteClientPath('/accounts/:accountId', 'accountId', 'acct/blue?draft#1');
    expect(path).toBe('/accounts/acct%2Fblue%3Fdraft%231');
    expect(
      resolveClientUrl('/api', path, [
        { name: 'include', value: 'roles & permissions' },
        { name: 'already', value: '%2F' },
      ]),
    ).toBe('/api/accounts/acct%2Fblue%3Fdraft%231?include=roles%20%26%20permissions&already=%252F');
  });

  it('uses RFC 3986 spelling rather than form encoding', () => {
    expect(encodeClientComponent(" !'()*")).toBe('%20%21%27%28%29%2A');
    expect(serializeClientQuery([{ name: 'a b', value: 'c+d' }])).toBe('a%20b=c%2Bd');
  });

  it('stringifies every admitted scalar deterministically', () => {
    expect([
      stringifyClientScalar('value'),
      stringifyClientScalar(12.5),
      stringifyClientScalar(42n),
      stringifyClientScalar(false),
      stringifyClientScalar(new Date('2026-09-05T00:00:00.000Z')),
    ]).toEqual(['value', '12.5', '42', 'false', '2026-09-05T00:00:00.000Z']);
  });

  it('rejects non-finite and invalid scalar values', () => {
    expect(() => stringifyClientScalar(Number.NaN)).toThrow(/finite/u);
    expect(() => stringifyClientScalar(Number.POSITIVE_INFINITY)).toThrow(/finite/u);
    expect(() => stringifyClientScalar(new Date(Number.NaN))).toThrow(/valid/u);
  });

  it('rejects ambiguous base URL spellings and deployment data', () => {
    for (const value of [
      'api.example.test',
      '//api.example.test',
      'ftp://api.example.test',
      'https://user:pass@api.example.test',
      'https://api.example.test?region=one',
      '/api#fragment',
    ]) {
      expect(() => normalizeClientBaseUrl(value), value).toThrow();
    }
  });

  it('requires exactly one path slot and preserves every other segment', () => {
    expect(() => substituteClientPath('/users/id', 'id', 'one')).toThrow(/exactly one/u);
    expect(() => substituteClientPath('/users/:id/related/:id', 'id', 'one')).toThrow(/exactly one/u);
    expect(substituteClientPath('/users/:id/related', 'id', 'one')).toBe('/users/one/related');
  });
});
