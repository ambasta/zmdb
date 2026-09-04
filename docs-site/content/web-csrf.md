> `createCsrf()` ships stateless, session-bound CSRF protection for
> cookie-authenticated routes. It combines an explicit origin allow-list with a
> signed token, exposes a route guard, and deliberately refuses to operate
> without a cookie-session identity.

## Whether you need it at all

This is the first question, and for most zmdb applications the answer is no.

CSRF exists because browsers attach **cookies** automatically to cross-site requests. If your API does not authenticate with cookies, there is nothing to forge:

| Authentication                      | CSRF risk                                       |
| ----------------------------------- | ----------------------------------------------- |
| `Authorization: Bearer <token>`     | **None.** Browsers do not attach it cross-site. |
| Cookie session                      | **Yes.** This is the case CSRF defends.         |
| API key in a header                 | None, same reason as bearer.                    |
| Cookie + `SameSite=Strict` or `Lax` | Largely mitigated; see below.                   |

A JSON API using bearer tokens — the default shape for a zmdb application — does not need CSRF tokens. Adding them is not free (a token endpoint, client changes, a rotation story), so do not add them reflexively.

## If you use cookies, `SameSite` first

```
Set-Cookie: sid=…; HttpOnly; Secure; SameSite=Lax; Path=/
```

`SameSite=Lax` stops the cookie being sent on cross-site `POST`, `PUT`, `PATCH` and `DELETE`, which is the entire CSRF surface for a JSON API. It is supported everywhere and is the default in current browsers.

`Strict` is stronger and breaks any flow where a user arrives from an external link expecting to be logged in.

Also set `HttpOnly` (so XSS cannot read the session) and `Secure` (so it never travels over plaintext). Neither is CSRF, both are non-negotiable.

## Configure the helper

```ts
import { createCsrf } from '@zmdb/web';

const csrf = await createCsrf({
  // Load the same application-owned secret on every replica.
  secret: csrfSecret,
  sessionOf: ctx => sessionIdFromCookie(ctx.headers.cookie),
  allowedOrigins: ['https://app.example.com'],
});
```

`csrfSecret` is a non-empty `Uint8Array<ArrayBuffer>`. Load it from application
configuration; generating it inside each process would invalidate outstanding
tokens on restart and make replicas disagree.

`allowedOrigins` is required, non-empty and has no wildcard form. Entries are
normalised as origins, so a default port or trailing slash is harmless, while a
path, query, credentials, opaque URL or wildcard is rejected during
construction. On an unsafe request, a missing or malformed `Origin`/`Referer`
is the same fixed 403 as a bad token.

`headerName` defaults to `x-csrf-token` and may be changed to another valid HTTP
field name.

## Issue a token

```ts
@Get('/csrf')
async token(ctx: AnyCtx) {
  return { token: await csrf.issue(ctx) };
}
```

Fetch this endpoint after login, keep the returned token in memory, and send it
in `x-csrf-token` on protected mutations. The token has the lifetime of the
session it is bound to: rotating the session id automatically invalidates the
old token.

The unmasked token is:

```
nonce ‖ '.' ‖ base64url(HMAC-SHA256(secret, sessionId ‖ '.' ‖ nonce))
```

Verification recomputes the MAC over the session id taken from the request. A
cookie an attacker can write is therefore useless without the application
secret. There is no CSRF cookie and no server-side token store.

The returned token is masked with fresh random bytes on every issue. That adds
no secrecy; it makes the response bytes different every time, removing the
[BREACH](./web-compression.html) side channel structurally.

## Protect routes

```ts
router.register(new OrdersController(), {
  update: { guards: [csrf.guard()] },
  remove: { guards: [csrf.guard()] },
});
```

The keys are handler names in the existing `RouteOptions` record. The guard runs
before body validation and the handler. A refusal produces the router's fixed
`403 {"error":"forbidden"}` response.

`GET`, `HEAD`, `OPTIONS` and `TRACE` are exempt. Every other exact method
spelling is checked, including an unsafe request carrying a method-override
header; zmdb does not interpret those headers.

`verify(ctx)` exposes the same check for explicit composition. Ordinary CSRF
refusals throw a status-carrying 403 with one fixed message. A missing session
identity is instead a configuration error: `guard()` rethrows it rather than
turning a bearer-token API into an apparently protected route.

## Origin checks are part of verification

Browsers set `Origin` on cross-origin state-changing requests and page
JavaScript cannot forge it. `verify()` always checks `Origin`, falling back to
the origin of `Referer`, before accepting the token.

A missing origin, malformed URL, opaque origin such as `null`, joined duplicate
header, or origin outside the explicit allow-list is rejected. The request's
origin is never reflected into a response. CORS remains separate: a restrictive
`access-control-allow-origin` does not stop a form post that needs no preflight.

## Comparison strategy

The implementation uses Web Crypto HMAC throughout. Web Crypto has no
constant-time byte-comparison primitive, and a hand-written XOR accumulator
would depend on JIT behaviour. Instead, verification MACs both the expected and
supplied values under a fresh in-process comparison key, then compares those
unpredictable digests. An attacker cannot steer either comparison value, so the
branch timing reveals nothing about the application secret.

## What to check regardless

- **`GET` must not change state.** A CSRF defence on unsafe methods is worthless if `GET /posts/1/delete` works. This is worth auditing: `getRoutes(Controller)` returns every method and path declared on one
  controller, so the audit is a loop over your controller list. There is no route-table
  introspection on `Router`.
- **CORS is not CSRF protection.** A permissive `access-control-allow-origin` makes things worse, but a restrictive one does not stop a form post, which needs no preflight. See [CORS](./web-cors.html).
- **Never reflect the request's `Origin`** into `access-control-allow-origin` with credentials enabled. That is equivalent to allowing every origin.

## What it does not protect

A CSRF token can look more comprehensive in an audit than it really is.

- **XSS.** A script on your origin reads any token your page can read and sets any header your page can set. CSRF protection assumes the origin is not compromised. A missing escape is not a CSRF problem and no token configuration fixes it.
- **A stolen session cookie.** The attacker replays the session directly.
- **Network interception.** That is TLS's job.
- **Clickjacking.** The user makes the request themselves, on your origin, with a valid token. `frame-ancestors` is the control.
- **A mutating `GET`.** Bypasses every method-based defence there is, including this one.

---

See also: [CORS](./web-cors.html) · [Cookies and Sessions](./web-cookies-sessions.html) · [Authentication](./web-authentication.html)
