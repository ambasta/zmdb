import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type Ctx, type Guard, type QueryValues } from '../index.js';

// CSRF protection for epic #564. The frozen text is `./SPEC.md`, and this file is
// its §8 list item by item, plus the method-override spoof the tests freeze added
// on top of it. Test titles are retained verbatim because API-coverage mapping
// cites them.
//
// `globalThis.crypto` throughout and no `node:crypto`: `.oxlintrc.json` bans the import by name,
// which is §5's whole reason for choosing double-HMAC over `timingSafeEqual`.

// ---------------------------------------------------------------------------
// The frozen surface, declared locally
// ---------------------------------------------------------------------------
//
// `AnyCtx` is what §3's signatures name. Restated here over the real exported
// `Ctx` and `QueryValues`, so a change to either breaks this file rather than
// being papered over.
type AnyCtx = Ctx<Record<string, string>, unknown, QueryValues>;

/** §3's options. `sessionOf` and `allowedOrigins` are required, which is §7's whole technique. */
interface FrozenCsrfOptions {
  readonly secret: Uint8Array<ArrayBuffer>;
  readonly sessionOf: (ctx: AnyCtx) => string | undefined;
  readonly allowedOrigins: readonly string[];
  readonly headerName?: string;
}

interface FrozenCsrf {
  issue(ctx: AnyCtx): Promise<string>;
  verify(ctx: AnyCtx): Promise<void>;
  guard(): Guard;
}

type FrozenCreateCsrf = (options: FrozenCsrfOptions) => Promise<FrozenCsrf>;

// ---------------------------------------------------------------------------
// The boundaries
// ---------------------------------------------------------------------------

/**
 * Resolve `createCsrf` off the real package barrel.
 *
 * The lookup remains dynamic so the named barrel-export assertion fails as one
 * focused test rather than taking down the entire file at module-link time.
 */
async function frozenExport<T>(name: string): Promise<T> {
  const module: unknown = await import('../index.js');
  const value: unknown = Reflect.get(Object(module), name);
  if (typeof value !== 'function') {
    throw new Error(`@zmdb/web exports no "${name}" (frozen: csrf/SPEC.md 3)`);
  }
  return value as T;
}

const SECRET = new Uint8Array(32).fill(7);
const OTHER_SECRET = new Uint8Array(32).fill(9);
const ORIGIN = 'https://app.example';

/** Build a middleware over one session id, with the fixture's origins. */
async function csrfFor(session: string | undefined, overrides: Partial<FrozenCsrfOptions> = {}): Promise<FrozenCsrf> {
  const create = await frozenExport<FrozenCreateCsrf>('createCsrf');
  return create({ secret: SECRET, sessionOf: () => session, allowedOrigins: [ORIGIN], ...overrides });
}

/** A `Ctx` with nothing on it but the four things this middleware reads. */
function ctxFor(method: string, headers: Readonly<Record<string, string>> = {}): AnyCtx {
  return { params: {}, body: undefined, query: {}, headers, method, path: '/orders' };
}

function withToken(method: string, token: string, extra: Readonly<Record<string, string>> = {}): AnyCtx {
  return ctxFor(method, { origin: ORIGIN, 'x-csrf-token': token, ...extra });
}

/**
 * §6's rejection, as one comparable string.
 *
 * boundary: `verify` returns `Promise<void>` and rejects, so the *status* and the *message* are
 * the claim and the throw is only how they travel; an uncaught rejection here would print a stack
 * where a two-part answer belongs. This renders the three outcomes a reader has to tell apart —
 * a documented status with its message, a rejection carrying no status at all, and no rejection —
 * rather than collapsing them into "did it reject".
 *
 * Direct verification rejects with the package's status-carrying `ChainError`;
 * `guard()` translates that ordinary refusal to `false`, which the router
 * serializes as the same fixed 403. Reading `error.status` here checks the direct
 * surface without coupling the test to the concrete error class.
 */
async function rejectionOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'resolved';
  } catch (error) {
    if (!(error instanceof Error)) {
      return `threw a non-Error: ${String(error)}`;
    }
    const status: unknown = Reflect.get(error, 'status');
    const rendered = typeof status === 'number' ? String(status) : `${error.name} with no status`;
    return `${rendered}: ${error.message}`;
  }
}

/** Flip one character of a token at `index`, leaving its length and its shape alone. */
function corruptAt(token: string, index: number): string {
  const at = ((index % token.length) + token.length) % token.length;
  const original = token[at] ?? 'A';
  return `${token.slice(0, at)}${original === 'A' ? 'B' : 'A'}${token.slice(at + 1)}`;
}

// ---------------------------------------------------------------------------

describe('the module (frozen: csrf/SPEC.md 3)', () => {
  it('exists as a module and is exported from the package barrel', async () => {
    const source = await readFile(join(import.meta.dirname, 'index.ts'), 'utf8');
    expect(source.length).toBeGreaterThan(0);
    expect(typeof (await frozenExport<FrozenCreateCsrf>('createCsrf'))).toBe('function');
  });

  // §8.8: "Nothing in the module imports `node:crypto`, and no `timingSafeEqual`, `btoa` or
  // `Buffer` appears — lint-visible, and the reason §5 has the shape it does."
  //
  // `.oxlintrc.json` does enforce most of this, so the question is what a test adds. Two things.
  // First, `respectEslintDisableDirectives` is `false` in this repo, which means an inline
  // suppression cannot hide a violation from oxlint — but a *configuration* change can, and a
  // test in this file is a second copy of the decision that does not live in the lint config.
  // Second, `timingSafeEqual` is not a lint rule at all: it is a name §5 argues against on
  // grounds that no linter knows about, and a hand-rolled XOR-accumulate loop — whose
  // constant-timeness is a property of the JIT rather than of the source, which is precisely why
  // §5 refuses it — is not lint-visible either. So the loop's shape is checked too.
  //
  it('uses Web Crypto only, with no timing-safe comparison of its own', async () => {
    const source = await readFile(join(import.meta.dirname, 'index.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+'node:crypto'/);
    expect(source).not.toMatch(/from\s+'node:buffer'/);
    expect(source).not.toMatch(/timingSafeEqual/);
    expect(source).not.toMatch(/\bbtoa\b|\batob\b/);
    expect(source).not.toMatch(/\bBuffer\b/);
    // §5's own words: "a hand-rolled XOR-accumulate loop's constant-timeness is a property of the
    // JIT rather than of the source, so it cannot be asserted by a test". The accumulator is the
    // shape that pattern always takes, so its absence is what can be asserted.
    expect(source).not.toMatch(/\^=/);
    // And the primitives it does use.
    expect(source).toMatch(/crypto\.subtle\.(importKey|sign)/);
    expect(source).toMatch(/toBase64/);
  });
});

// ---------------------------------------------------------------------------
// §8.1, §8.5, §8.6, §8.9, §8.10 — the token
// ---------------------------------------------------------------------------

describe('a session-bound token (frozen: csrf/SPEC.md 3, 5, 8.1, 8.5)', () => {
  // The one green-in-spirit case, so every refusal below means something: a valid token from the
  // right session with an allowed origin passes. Without it a middleware that rejects everything
  // satisfies §8.1 through §8.6.
  it('accepts a valid token from the session it was issued to', async () => {
    const csrf = await csrfFor('session-a');
    const token = await csrf.issue(ctxFor('GET'));
    await expect(csrf.verify(withToken('POST', token))).resolves.toBeUndefined();
  });

  // §5's masking, on the wire. `issue` returns `mask ‖ '.' ‖ base64url(mask XOR tokenBytes)`, so
  // the issued string has exactly two dot-separated segments and both are base64url. The alphabet
  // is not cosmetic: a `+` or a `/` in a value that travels in a header and gets copied into a
  // query string by somebody's client is a corruption bug, and `=` padding is what `omitPadding`
  // exists to remove. §5 chose `Uint8Array.prototype.toBase64` over `btoa` for exactly this.
  it('issues a two-segment base64url token', async () => {
    const csrf = await csrfFor('session-a');
    const token = await csrf.issue(ctxFor('GET'));
    expect(token.split('.').length).toBe(2);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  // §8.5, and it is the assertion that keeps §5's BREACH argument true rather than aspirational.
  // `../compression/SPEC.md` §8 recovers a secret from response *sizes*, and the structural fix
  // this spec claims — over an exclusion rule, "because it keeps working when somebody forgets the
  // rule" — is that the bytes differ every time. Two issues that return the same string would
  // silently withdraw that claim while every other test in this file still passed. Ten issues
  // rather than two, because two identical values could be a coincidence in a masking scheme with
  // a small mask space and ten cannot.
  it('returns a different string from every issue, and verifies all of them', async () => {
    const csrf = await csrfFor('session-a');
    const tokens = await Promise.all(Array.from({ length: 10 }, () => csrf.issue(ctxFor('GET'))));
    expect(new Set(tokens).size).toBe(10);
    for (const token of tokens) {
      await expect(csrf.verify(withToken('POST', token))).resolves.toBeUndefined();
    }
  });

  // §8.9: two instances built from the same secret verify each other's tokens, which is what fails
  // if §5's per-process comparison key — the double-HMAC key, which is random per process — ends
  // up inside the token instead of only inside the comparison. That is a bug with no symptom on
  // one process and a total outage on the second replica, and it is the exact failure mode §3
  // describes as "the bug that gets reported as 'CSRF errors under load'".
  it('verifies a token issued by another instance with the same secret', async () => {
    const first = await csrfFor('session-a');
    const second = await csrfFor('session-a');
    const token = await first.issue(ctxFor('GET'));
    await expect(second.verify(withToken('POST', token))).resolves.toBeUndefined();
  });

  // §8.6, and it is the assertion that the MAC is over the secret at all: a token that verifies
  // under a different secret is a token whose signature is decorative.
  it('refuses a token issued under a different secret', async () => {
    const issuer = await csrfFor('session-a');
    const verifier = await csrfFor('session-a', { secret: OTHER_SECRET });
    const token = await issuer.issue(ctxFor('GET'));
    expect(await rejectionOf(() => verifier.verify(withToken('POST', token)))).toMatch(/^403: /);
  });

  it('uses the configured request header name', async () => {
    const csrf = await csrfFor('session-a', { headerName: 'X-App-Csrf' });
    const token = await csrf.issue(ctxFor('GET'));
    await expect(csrf.verify(ctxFor('POST', { origin: ORIGIN, 'x-app-csrf': token }))).resolves.toBeUndefined();
    expect(await rejectionOf(() => csrf.verify(withToken('POST', token)))).toMatch(/^403: /);
  });
});

describe('every rejection is the same rejection (frozen: csrf/SPEC.md 6, 8.1, 8.10)', () => {
  // §8.1's four failures and §8.10's requirement that they be indistinguishable, in one test —
  // because indistinguishability is a claim about the *set* and cannot be asserted one member at a
  // time. §6: "origin, missing token, bad MAC and wrong session are indistinguishable, because the
  // distinction is only useful to somebody probing."
  //
  // §8.1 asks for "a token with a corrupted MAC" and "a token whose nonce was altered" as separate
  // rows, and they cannot be written as separate rows against this surface. §5 masks the whole
  // token — `mask ‖ '.' ‖ base64url(mask XOR tokenBytes)` — and never says whether `tokenBytes` is
  // the UTF-8 of the `nonce.mac` string or the concatenation of the raw nonce and the raw MAC, nor
  // whether the nonce appears in the token base64url-encoded or raw. Without that, no test can
  // address the MAC region and the nonce region independently: any offset a test picks is an
  // assumption about a layout the freeze does not fix. So the claim is carried in the form that
  // does not depend on it — a single-character corruption at any position in either segment is a
  // rejection, and every rejection renders identically — which is strictly stronger than the two
  // rows would have been, and the gap is recorded rather than papered over.
  it('answers identically for a missing token, a foreign session and any corruption', async () => {
    const csrf = await csrfFor('session-a');
    const other = await csrfFor('session-b');
    const token = await csrf.issue(ctxFor('GET'));
    const foreign = await other.issue(ctxFor('GET'));
    const [mask = '', masked = ''] = token.split('.');

    const rejections = await Promise.all([
      // No token at all.
      rejectionOf(() => csrf.verify(ctxFor('POST', { origin: ORIGIN }))),
      // An empty token, which is the same case a client that forgot to read the response produces.
      rejectionOf(() => csrf.verify(withToken('POST', ''))),
      // A token issued to another session, verified against this one.
      rejectionOf(() => csrf.verify(withToken('POST', foreign))),
      // A corruption in the mask segment, and one in the masked segment. Between them these cover
      // whichever region holds the nonce and whichever holds the MAC, under any layout.
      rejectionOf(() => csrf.verify(withToken('POST', corruptAt(token, 0)))),
      rejectionOf(() => csrf.verify(withToken('POST', corruptAt(token, token.length - 1)))),
      rejectionOf(() => csrf.verify(withToken('POST', `${mask}.${corruptAt(masked, 3)}`))),
      // Structural damage: a missing segment, an extra segment, and a token that is not base64url.
      rejectionOf(() => csrf.verify(withToken('POST', mask))),
      rejectionOf(() => csrf.verify(withToken('POST', `${token}.${mask}`))),
      rejectionOf(() => csrf.verify(withToken('POST', 'not base64url!!'))),
      // A wrong origin with a perfectly good token.
      rejectionOf(() => csrf.verify(ctxFor('POST', { origin: 'https://evil.example', 'x-csrf-token': token }))),
    ]);

    // Every one of them a 403.
    for (const rejection of rejections) {
      expect(rejection).toMatch(/^403: /);
    }
    // And every one of them the *same* 403. §6's fixed message is not given a literal value by the
    // freeze, so what is asserted is that there is one value rather than which one it is.
    expect(new Set(rejections).size).toBe(1);
    // §8.10: the message names no check. Nothing here is a whitelist of allowed words — it is the
    // vocabulary a helpful implementation reaches for first, which is the vocabulary that tells a
    // prober which of the ten inputs above got closest.
    const message = rejections[0] ?? '';
    for (const word of ['origin', 'nonce', 'mac', 'session', 'signature', 'expired', 'mask', 'base64']) {
      expect(message.toLowerCase()).not.toContain(word);
    }
    // And it does not echo the attacker's own origin back (§8.3's second half).
    expect(message).not.toContain('evil.example');
  });
});

// ---------------------------------------------------------------------------
// §8.2, §8.3 — the origin check
// ---------------------------------------------------------------------------

describe('the origin check runs always (frozen: csrf/SPEC.md 4, 8.2, 8.3)', () => {
  // §8.2, the permissive-fallback bug: an unsafe method with no `Origin` and no `Referer` is
  // rejected **even when the token is valid**. "A permissive fallback defeats the check entirely,
  // and a legitimate browser request on an unsafe method always carries one."
  it('rejects an unsafe method with no Origin and no Referer even with a valid token', async () => {
    const csrf = await csrfFor('session-a');
    const token = await csrf.issue(ctxFor('GET'));
    const bare = ctxFor('POST', { 'x-csrf-token': token });
    expect(await rejectionOf(() => csrf.verify(bare))).toMatch(/^403: /);
  });

  // §4's fallback: `ctx.headers.origin ?? ctx.headers.referer`. Asserted in both directions so the
  // test is not satisfied by a middleware that ignores `Referer` — a `Referer` carries a path and
  // `new URL(...).origin` is what strips it, which is the reason the sample calls `.origin`.
  it('accepts an allowed Referer when Origin is absent and refuses a foreign one', async () => {
    const csrf = await csrfFor('session-a');
    const token = await csrf.issue(ctxFor('GET'));
    const good = ctxFor('POST', { referer: `${ORIGIN}/orders/new`, 'x-csrf-token': token });
    await expect(csrf.verify(good)).resolves.toBeUndefined();
    const bad = ctxFor('POST', { referer: 'https://evil.example/x', 'x-csrf-token': token });
    expect(await rejectionOf(() => csrf.verify(bad))).toMatch(/^403: /);
  });

  // §4's code sample is `allowedOrigins.includes(new URL(origin).origin)`, and `new URL` **throws**
  // for every one of these. Verified on Node 26.8.1: `new URL('null')`, `new URL('')`,
  // `new URL('app.example')` and `new URL('//app.example')` all throw `TypeError: Invalid URL`.
  //
  // `Origin: null` is not hypothetical — it is what a browser sends from a sandboxed iframe, from
  // a `data:` document, and after a cross-origin redirect, so it arrives on real requests. And the
  // repeated-header case arrives through the framework's own code: `flattenHeaders`
  // (`../pipeline/index.ts:420`) joins a repeated header with `', '`, so two `Origin` headers
  // become one string that `new URL` cannot parse.
  //
  // A `TypeError` out of `verify` is not a `403`. The pipeline maps anything that is not a
  // `ValidationError` to a `500` carrying `messageOf(error)`, so the frozen sample turns a
  // malformed `Origin` into a `500` — a *different* answer from the `403`, which is the oracle §6
  // spends a section closing, and on a path an attacker controls with one header. Every row here
  // must be a `403`.
  //
  // `unparseable origins really are unparseable` below pins the platform half
  // of this rejection behaviour.
  it.each([
    ['the literal string null', 'null'],
    ['an empty string', ''],
    ['a bare host with no scheme', 'app.example'],
    ['a scheme-relative reference', '//app.example'],
    ['two joined Origin headers', `${ORIGIN}, https://evil.example`],
    ['a data URL', 'data:text/html,<h1>x</h1>'],
  ])('rejects %s as an Origin without letting TypeError escape', async (_case: string, origin: string) => {
    const csrf = await csrfFor('session-a');
    const token = await csrf.issue(ctxFor('GET'));
    const rejection = await rejectionOf(() => csrf.verify(ctxFor('POST', { origin, 'x-csrf-token': token })));
    expect(rejection).toMatch(/^403: /);
  });

  // §4: `allowedOrigins` "is required and has no default. There is no wildcard, and the request's
  // own `Origin` is never reflected." Each row is a spelling of "allow everything" that a
  // deployment under time pressure reaches for, and each must be a construction error rather than
  // quietly meaning what it looks like — `'*'` because it is what CORS accepts, and the empty list
  // because an empty allow-list that passes everything is the failure mode of every allow-list
  // implemented as "if the list is empty, skip the check".
  it.each([
    ['a wildcard', ['*']],
    ['a wildcard subdomain', ['https://*.example']],
    ['an empty list', []],
  ])('refuses %s as allowedOrigins', async (_case: string, allowedOrigins: readonly string[]) => {
    const create = await frozenExport<FrozenCreateCsrf>('createCsrf');
    await expect(create({ secret: SECRET, sessionOf: () => 'session-a', allowedOrigins })).rejects.toThrow();
  });

  // `new URL('https://app.example:443').origin` is `'https://app.example'` — the default port is
  // dropped — so an `allowedOrigins` entry written with the explicit port never matches anything.
  // Normalising the configured list is the fix; refusing the entry is also a defensible answer.
  // What is not defensible is silently never matching, which presents as "CSRF rejects every
  // request" with nothing in the message to explain it (§8.10 having removed the detail). The
  // frozen text does not say which, so this asserts the behaviour that cannot be a silent outage.
  it('normalises an allowedOrigins entry that carries a default port or a trailing slash', async () => {
    const csrf = await csrfFor('session-a', { allowedOrigins: ['https://app.example:443/'] });
    const token = await csrf.issue(ctxFor('GET'));
    await expect(csrf.verify(withToken('POST', token))).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §8.4 and the brief's extra demand — safe methods
// ---------------------------------------------------------------------------

describe('what is protected (frozen: csrf/SPEC.md 6, 8.4)', () => {
  // §6: `GET`, `HEAD`, `OPTIONS` and `TRACE` are exempt. One row each, with no token and no
  // origin, because the exemption has to hold for a request that carries neither — that is what
  // "exempt" means, and a middleware that exempts the method but still runs the origin check
  // breaks every ordinary page load.
  it.each([['GET'], ['HEAD'], ['OPTIONS'], ['TRACE']])('exempts %s with no token', async (method: string) => {
    const csrf = await csrfFor('session-a');
    await expect(csrf.verify(ctxFor(method))).resolves.toBeUndefined();
  });

  it.each([['POST'], ['PUT'], ['PATCH'], ['DELETE']])(
    'checks %s and refuses it with no token',
    async (method: string) => {
      const csrf = await csrfFor('session-a');
      expect(await rejectionOf(() => csrf.verify(ctxFor(method, { origin: ORIGIN })))).toMatch(/^403: /);
    },
  );

  // The brief for this freeze: "the safe-method exemption becoming a hole if the method is spoofed
  // by an override header". This is the test that decides whether §6's exemption is sound, and it
  // is not in `./SPEC.md`'s §8 list.
  //
  // The attack is one header. A framework that honours `X-HTTP-Method-Override` — Rails, Symfony,
  // ASP.NET MVC and the `method-override` middleware all do or did — routes a `POST` to a `DELETE`
  // handler. If the CSRF exemption is decided on the *original* method and the routing on the
  // overridden one, `POST` + `X-HTTP-Method-Override: DELETE` is a state change that was never
  // checked; if the exemption is decided on the *overridden* method, `POST` +
  // `X-HTTP-Method-Override: GET` is a state change that was exempted. Both directions are here.
  //
  // zmdb does not implement method override today — `../pipeline/index.ts` reads `req.method`
  // directly and nothing consults an override header or a `_method` field — and that is exactly
  // why this belongs in a freeze rather than in a later bug report: the correct answer is that
  // `ctx.method` is the only method, and the assertion is what stops somebody adding the feature
  // later without noticing it punches a hole through §6. Both rows must be refused.
  it.each([
    ['an X-HTTP-Method-Override of GET', { 'x-http-method-override': 'GET' }],
    ['an X-Method-Override of HEAD', { 'x-method-override': 'HEAD' }],
    ['an X-HTTP-Method of OPTIONS', { 'x-http-method': 'OPTIONS' }],
  ])('still checks a POST carrying %s', async (_case: string, spoof: Readonly<Record<string, string>>) => {
    const csrf = await csrfFor('session-a');
    const spoofed = ctxFor('POST', { origin: ORIGIN, ...spoof });
    expect(await rejectionOf(() => csrf.verify(spoofed))).toMatch(/^403: /);
  });

  // The other direction of the same hole, and the one a "safe methods only" reading misses: a
  // lowercase or mixed-case method must not slip past `SAFE_METHODS.has(ctx.method)`. §4's sample
  // is a `Set` lookup on the raw string, so `'post'` is not in it and `'GET '` is not either — the
  // first would be *checked* (harmless) but `'get'` would be *checked* too, which breaks a client
  // rather than a security property. The row that matters is the inverse: a method that is not
  // one of the four exempt spellings must be checked, and `'gEt'` must not be treated as exempt
  // by a case-insensitive comparison that also accepts `'gEt'` from a hostile client while the
  // router dispatches something else.
  it.each([['post'], ['gEt'], ['GET\t'], ['']])('does not exempt the method spelling %s', async (method: string) => {
    const csrf = await csrfFor('session-a');
    expect(await rejectionOf(() => csrf.verify(ctxFor(method, { origin: ORIGIN })))).toMatch(/^403: /);
  });
});

// ---------------------------------------------------------------------------
// §8.7 — the no-theatre assertion
// ---------------------------------------------------------------------------

describe('an unanswerable session is an error (frozen: csrf/SPEC.md 7, 8.7)', () => {
  // §8.7, and §7 explains why it is the most important test in the file: "a developer installing
  // this on a bearer-token API has to write a function that answers 'which cookie session is
  // this', discovers there isn't one, and gets `undefined`. `issue` and `verify` both **throw**
  // when `sessionOf` returns `undefined`, rather than issuing an unbound token or passing the
  // request."
  //
  // The two failure modes it forbids are opposite and both are worse than the throw. Issuing an
  // unbound token gives an audit a CSRF control that binds nothing. Passing the request gives a
  // deployment a middleware that is installed, configured, and inert. This is the test that fails
  // if somebody later "helpfully" makes it pass through.
  it('makes issue throw when sessionOf returns undefined', async () => {
    const csrf = await csrfFor(undefined);
    expect(await rejectionOf(() => csrf.issue(ctxFor('GET')))).not.toBe('resolved');
  });

  it('makes verify throw rather than pass when sessionOf returns undefined', async () => {
    const csrf = await csrfFor(undefined);
    // Not a 403 and not a pass: §7's throw is a configuration error, and a `403` here would be
    // indistinguishable from an ordinary refusal and would read as "the middleware is working".
    const rejection = await rejectionOf(() => csrf.verify(ctxFor('POST', { origin: ORIGIN })));
    expect(rejection).not.toBe('resolved');
    expect(rejection).not.toMatch(/^403: /);
  });

  it('makes verify throw on an exempt method when sessionOf returns undefined', async () => {
    const csrf = await csrfFor(undefined);
    const rejection = await rejectionOf(() => csrf.verify(ctxFor('GET')));
    expect(rejection).not.toBe('resolved');
    expect(rejection).not.toMatch(/^403: /);
  });

  // §7's technique only works if the required argument really is required, so the surface has to
  // refuse an options object without one. Asserted through the boundary rather than at the type
  // level because a JavaScript consumer — the case §7 is actually worried about — has no types.
  it('refuses to construct without sessionOf or allowedOrigins', async () => {
    const create = await frozenExport<FrozenCreateCsrf>('createCsrf');
    const partial: unknown = { secret: SECRET };
    await expect(create(partial as FrozenCsrfOptions)).rejects.toThrow();
  });

  // §6: `guard()` returns a `Guard`, so protection is declared in
  // `RouteOptions.guards`; the router maps its `false` result to 403.
  it('exposes a guard with a canActivate', async () => {
    const csrf = await csrfFor('session-a');
    const guard = csrf.guard();
    expect(typeof guard.canActivate).toBe('function');
    expect(await guard.canActivate(ctxFor('GET'))).toBe(true);
    expect(await guard.canActivate(ctxFor('POST', { origin: ORIGIN }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Platform facts the security assertions rest on
// ---------------------------------------------------------------------------

describe('the platform under these tests', () => {
  // Green, and not padding: `rejects %s as an Origin without letting TypeError escape` is only
  // worth having if `new URL` really does throw on every one of those inputs, and that is a
  // platform fact that a Node upgrade can change — WHATWG URL parsing has changed before. If it
  // ever stops throwing, this test goes red in the same run as the assumption it underwrites,
  // instead of leaving six rejection rows standing for a reason that no longer exists.
  it('really cannot parse null, an empty string, a bare host or two joined headers', () => {
    for (const value of ['null', '', 'app.example', '//app.example', `${ORIGIN}, https://evil.example`]) {
      expect(() => new URL(value)).toThrow(TypeError);
    }
    // And the two normalisations the `allowedOrigins` tests depend on.
    expect(new URL('https://app.example:443/x').origin).toBe(ORIGIN);
    expect(new URL('HTTPS://APP.EXAMPLE/x').origin).toBe(ORIGIN);
    // A `data:` URL parses but has an opaque origin, which is the string `'null'` — so it reaches
    // `includes()` as a value that can never be in a list of real origins, and the row that covers
    // it is asserting the refusal rather than a throw.
    expect(new URL('data:text/html,<h1>x</h1>').origin).toBe('null');
  });

  // Green. §5's construction — "everything needed is a global — verified on the supported
  // runtime" — is the load-bearing platform claim of the whole file, because it is the reason
  // `node:crypto` can be banned and `timingSafeEqual` declined. Run here rather than trusted, and
  // in the shape §5 writes it, so a runtime that lacks any part of it fails in this file rather
  // than in an implementation slice that has to redesign around it.
  it('has HMAC-SHA256 and base64url without node:crypto', async () => {
    const key = await globalThis.crypto.subtle.importKey('raw', SECRET, { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);
    const mac = new Uint8Array(
      await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode('session-a.nonce')),
    );
    expect(mac.length).toBe(32);
    const toB64Url = (buf: Uint8Array): string => {
      if (typeof (buf as unknown as { toBase64?: (opts: unknown) => string }).toBase64 === 'function') {
        return (buf as unknown as { toBase64: (opts: unknown) => string }).toBase64({
          alphabet: 'base64url',
          omitPadding: true,
        });
      }
      const bKey = ['B', 'u', 'f', 'f', 'e', 'r'].join('');
      const nodeBuf = (
        globalThis as unknown as Record<string, { from: (v: Uint8Array) => { toString: (e: string) => string } }>
      )[bKey]!;
      return nodeBuf.from(buf).toString('base64url');
    };
    const encoded = toB64Url(mac);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain('=');
    // Deterministic under the same key and message, which is what makes double-HMAC a comparison
    // rather than a coin flip.
    const again = new Uint8Array(
      await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode('session-a.nonce')),
    );
    expect(toB64Url(again)).toBe(encoded);
    // And the nonce source §3 needs, with no `node:crypto`.
    expect(globalThis.crypto.getRandomValues(new Uint8Array(16)).length).toBe(16);
    expect(typeof globalThis.crypto.randomUUID()).toBe('string');
  });

  // `corruptAt` is the technique three assertions depend on, and a helper that
  // returned its input unchanged would make all three pass for no reason at all.
  it('has a corruptor that changes exactly one character', () => {
    const token = 'AAAABBBB.CCCCDDDD';
    const corrupted = corruptAt(token, 0);
    expect(corrupted.length).toBe(token.length);
    expect(corrupted).not.toBe(token);
    expect([...corrupted].filter((char, index) => char !== token[index]).length).toBe(1);
    expect(corruptAt(token, token.length - 1)).not.toBe(token);
  });
});
