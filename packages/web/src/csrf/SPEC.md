# `@zmdb/web` — CSRF protection SPEC

> The threat model first, then a stateless session-bound token (epic #564, sub-issue #565). Frozen before code.

This is the one feature in the epic where the most valuable thing the spec can do is say when **not** to use it. A CSRF token on an API that does not authenticate with cookies protects nothing, costs
a token endpoint and a client change, and — worse — looks like a security control in an audit. Epic #564's item 6 says "no protection theatre", and §1 is how that is enforced rather than encouraged.

## 1. Threat model

**What CSRF is.** A browser attaches cookies to a request based on where the request is _going_, not where it came _from_. So a page on `evil.example` can cause the browser to send an authenticated
request to `app.example` — a form post, an image tag, a link the user clicks — and the application cannot tell it apart from one the user meant. The attacker never sees the response; the damage is the
state change.

**What it defends against.** Exactly that: a cross-site-initiated, state-changing request carrying an ambient credential.

**What it does not defend against, and this list is the point:**

- **XSS.** A script running on your origin reads any token your page can read and sets any header your page can set. CSRF protection assumes the origin is not compromised; if it is, the token is the
  attacker's too. A missing escape is not a CSRF problem and no token configuration fixes it.
- **A leaked or stolen session cookie.** The attacker replays the session directly.
- **Network interception.** That is TLS's job.
- **Clickjacking.** The user makes the request themselves, on your origin, with a valid token. `frame-ancestors` and `X-Frame-Options` are the controls.
- **A subdomain that can set cookies on the parent domain.** This defeats plain double-submit, which is why §3 does not use it.
- **`GET` that mutates.** `GET /posts/1/delete` bypasses every method-based defence there is, including this one. Auditable: `getRoutes` prints every method and path.

**When it is unnecessary, which is most of the time here.** If no credential is attached by the browser automatically, there is nothing to forge:

| authentication                    | CSRF exposure                                               |
| --------------------------------- | ----------------------------------------------------------- |
| `Authorization: Bearer …`         | none — the browser never attaches it cross-site             |
| API key in a header               | none, same reason                                           |
| cookie session, `SameSite=Strict` | none for cross-site requests; the cookie is not sent        |
| cookie session, `SameSite=Lax`    | none for unsafe methods; `Lax` withholds the cookie on them |
| cookie session, `SameSite=None`   | **yes** — this is the case this middleware is for           |
| cookie session, no `SameSite`     | **yes**, and fix the cookie first                           |

A JSON API with bearer tokens — the default shape for a zmdb application — does not need any of this. The middleware's documentation leads with that table, and §7 records how the surface makes it hard
to install pointlessly.

## 2. `SameSite` is the first control, not a footnote

```
Set-Cookie: sid=…; HttpOnly; Secure; SameSite=Lax; Path=/
```

`SameSite=Lax` withholds the cookie from cross-site `POST`, `PUT`, `PATCH` and `DELETE`, which is the entire CSRF surface of a JSON API. It is the browser default now and it is supported everywhere.
`HttpOnly` and `Secure` are not CSRF controls and are not optional either.

So the ordering is: set `SameSite`, add the origin check in §4 because it is free, and reach for a token only when a deployment genuinely needs `SameSite=None` — a cross-origin frontend on a different
site, or an embedded widget.

## 3. A stateless, session-bound signed token

```ts
export interface CsrfOptions {
  readonly secret: Uint8Array<ArrayBuffer>;
  readonly sessionOf: (ctx: AnyCtx) => string | undefined;
  readonly allowedOrigins: readonly string[];
  readonly headerName?: string; // default 'x-csrf-token'
}

export interface Csrf {
  issue(ctx: AnyCtx): Promise<string>;
  verify(ctx: AnyCtx): Promise<void>;
  guard(): Guard;
}

export declare function createCsrf(options: CsrfOptions): Promise<Csrf>;
```

The token is

```
nonce ‖ '.' ‖ base64url(HMAC-SHA256(secret, sessionId ‖ '.' ‖ nonce))
```

with a 16-byte random `nonce` per issue. Verification recomputes the MAC over the session id **taken from the request's own session**, so a token is only valid for the session it was issued to.

**Why this and not the two alternatives.**

- **Plain double-submit** (a random value in a readable cookie, echoed in a header) needs no server state and no secret, and it fails to one specific attacker: anyone who can set a cookie on your
  domain. A subdomain takeover, a compromised sibling application, or an HTTP response on any `*.example.com` host is enough — cookies ignore the origin's scheme and port. Binding the token to the
  session with a MAC makes a cookie the attacker can write useless, because they cannot produce a MAC for _your_ session id.
- **A synchroniser token** (a random value stored server-side per session) is equally strong and requires a store, which means either module-level state — banned by §2.7 — or a session backend this
  epic explicitly does not provide. The MAC buys the same binding with no storage.

**There is no CSRF cookie.** The token travels in the response body and comes back in a header. Removing the second cookie removes a second `SameSite`, `Secure`, `Path` and `Domain` to get wrong, and
the double-submit comparison it existed for is what §3's binding replaced.

**The token has no separate expiry.** Its lifetime is the session's, because the session id is inside the MAC: when the session ends the token stops verifying, and a new session — including the new
one issued after a login, which is where session fixation lives — needs a new token automatically. A second expiry would be a second clock to skew and a second failure mode to distinguish.

`secret` is a `Uint8Array<ArrayBuffer>` the application owns and passes in. Nothing is generated at module scope, per §2.7 — a process-generated secret means every restart and every replica
invalidates every outstanding token, which is the bug that gets reported as "CSRF errors under load".

## 4. The origin check runs always, and is not optional

```ts
if (!SAFE_METHODS.has(ctx.method)) {
  const origin = ctx.headers.origin ?? ctx.headers.referer;
  if (origin === undefined || !allowedOrigins.includes(new URL(origin).origin)) reject();
}
```

Browsers set `Origin` on every cross-origin state-changing request and page JavaScript cannot forge it. It costs one comparison, it needs no token endpoint, and it catches the case where a token
leaked. So it is part of `verify`, not an alternative to it.

**A missing `Origin` on an unsafe method is rejected**, not allowed through. A permissive fallback defeats the check entirely, and a legitimate browser request on an unsafe method always carries one.
A non-browser client that cannot send an `Origin` is by definition not subject to CSRF and should not be behind this middleware — which is §7's point.

`allowedOrigins` is required and has no default. There is no wildcard, and the request's own `Origin` is never reflected. CORS is a separate control with a separate failure mode and it is not CSRF
protection: a restrictive `access-control-allow-origin` does not stop a form post, which needs no preflight.

## 5. Comparison and masking

**Comparison is double-HMAC, not a timing-safe byte compare.** `.oxlintrc.json` bans importing `node:crypto`, so `timingSafeEqual` is unavailable; Web Crypto has no constant-time comparison primitive;
and a hand-rolled XOR-accumulate loop's constant-timeness is a property of the JIT rather than of the source, so it cannot be asserted by a test.

Double-HMAC removes the requirement instead of trying to satisfy it: MAC both the expected and the provided value under a per-process random key and compare the digests with `===`. An attacker cannot
steer a digest they cannot predict, so the timing of the comparison carries no information about the secret.

Everything needed is a global — verified on the supported runtime:

```ts
const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
const encoded = mac.toBase64({ alphabet: 'base64url', omitPadding: true });
```

`Uint8Array.prototype.toBase64` rather than `btoa`, which `.oxlintrc.json` bans by name.

**The issued token is masked per response.** `issue` returns `mask ‖ '.' ‖ base64url(mask XOR tokenBytes)` with a fresh 16-byte mask, and `verify` unmasks before checking. The mask does not add
secrecy — an attacker who sees the response sees both halves — and that is not what it is for.

It makes the _bytes_ of the response different every time, which removes the compression side channel: `../compression/SPEC.md` §8 explains that BREACH recovers a secret from response sizes, and a
secret whose encoding changes per response has no stable ratio to leak. That is a structural fix rather than an exclusion rule, so it keeps working when somebody forgets the rule.

## 6. What is protected

`GET`, `HEAD`, `OPTIONS` and `TRACE` are exempt; everything else is checked. That follows RFC 9110's safe methods and it is only sound if safe methods really are safe, which is why §1 lists a mutating
`GET` as something this cannot defend.

A rejection is a `403` with a fixed message and no detail about which check failed — origin, missing token, bad MAC and wrong session are indistinguishable, because the distinction is only useful to
somebody probing.

`guard()` returns a `Guard`, so protection is declared rather than called per handler. Route guards are wired through `RouteOptions.guards`, and the CSRF implementation registers there directly.

## 7. How a client gets a token, and how the surface resists theatre

```ts
@Get('/csrf')
async token(ctx: Ctx) {
  return { token: await this.csrf.issue(ctx) };
}
```

A single-page application fetches it after login and keeps it **in memory**, not in `localStorage`. XSS reads either one, so that is not the argument; memory does not survive into another tab or
another day, which limits what a one-shot injection gets.

The surface makes a pointless installation awkward on purpose. `sessionOf` is required and returns the session id the token binds to — so a developer installing this on a bearer-token API has to write
a function that answers "which cookie session is this", discovers there isn't one, and gets `undefined`. `issue` and `verify` both **throw** when `sessionOf` returns `undefined`, rather than issuing
an unbound token or passing the request.

A required argument that cannot be answered is a better warning than a paragraph in the documentation, and it is the same technique `../../../app/src/messaging/SPEC.md` §5 uses to make an
undeliverable message impossible to configure by accident.

## 8. What #566 has to assert

1. A request with a valid token and a valid origin passes; each of the four failures — no token, a token for another session, a token with a corrupted MAC, and a token whose nonce was altered — is a
   `403` with the identical body.
2. An unsafe method with **no** `Origin` and `no Referer` is rejected even when the token is valid. The permissive-fallback bug.
3. An `Origin` not in `allowedOrigins` is rejected even with a valid token, and the request's own `Origin` is never echoed anywhere.
4. `GET`, `HEAD`, `OPTIONS` and `TRACE` pass with no token; `POST`, `PUT`, `PATCH` and `DELETE` do not.
5. `issue` called twice for the same session returns **different strings**, and both verify. This is the masking assertion, and it is what keeps §5's BREACH argument true.
6. A token issued under one secret does not verify under another.
7. `sessionOf` returning `undefined` makes `issue` and `verify` throw — the no-theatre assertion, and the one that fails if somebody later "helpfully" makes it pass through.
8. Nothing in the module imports `node:crypto`, and no `timingSafeEqual`, `btoa` or `Buffer` appears — lint-visible, and the reason §5 has the shape it does.
9. Two `Csrf` instances created from the same secret verify each other's tokens; the per-process comparison key does not leak into the token.
10. A rejection message does not name the failing check.

## Non-goals (rejected)

- **Plain double-submit with a CSRF cookie** (§3) — broken by a subdomain that can write cookies, and it adds a cookie's worth of configuration.
- **A synchroniser token with server-side storage** (§3) — needs a session store this epic does not provide, and module-level state §2.7 forbids.
- **A separate token expiry** (§3).
- **Generating the secret inside the module** (§3) — invalidates every token on restart and disagrees between replicas.
- **A timing-safe byte comparison, hand-rolled or imported** (§5).
- **A wildcard or reflected `allowedOrigins`** (§4).
- **Allowing a missing `Origin`** (§4).
- **A session implementation.** Epic #564's non-goals. This middleware consumes a session id and does not know where it came from.
- **`SameSite` enforcement on the application's own session cookie.** The framework does not set that cookie; the documentation says what to set.
- **Distinguishing rejection reasons in the response** (§6).
- **Presenting this as useful for a bearer-token API** (§1, §7). The middleware refuses rather than reassures.
