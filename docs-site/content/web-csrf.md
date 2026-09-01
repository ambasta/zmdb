> **ToDo / feature gap.** There is no CSRF protection — no token middleware, no
> `csurf` equivalent, no double-submit helper. A handler also cannot set a
> response header, so a framework-issued token could not be delivered.

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

## The origin check

One line, no token, and effective for a JSON API:

```ts
const SAFE = new Set(['https://app.example.com']);

function requireSameOrigin(ctx: Ctx<Record<string, string>, unknown>): void {
  if (ctx.method === 'GET' || ctx.method === 'HEAD') return;
  const origin = ctx.headers.origin ?? ctx.headers.referer;
  if (origin === undefined || !SAFE.has(new URL(origin).origin)) {
    throw new ValidationError('cross-origin request rejected', []);
  }
}
```

Browsers set `Origin` on every cross-origin state-changing request and it cannot be forged by page JavaScript. Reject a missing origin on unsafe methods rather than allowing it — a permissive fallback defeats the check, and legitimate browser requests always include it.

Requiring `content-type: application/json` helps too: a cross-site form post cannot set it, and a browser will not send a JSON preflight without CORS permission.

## Double-submit tokens

When you need a token — a cookie-authenticated app supporting older browsers:

```ts
@Post('/csrf')
issue() {
  const token = randomBytes(32).toString('base64url');
  return json(
    { token },
    { headers: { 'set-cookie': `csrf=${token}; Secure; SameSite=Lax; Path=/` } },
  );
}
```

The client stores it and sends it as `x-csrf-token` on every mutation; you compare it against the same value in the non-`HttpOnly` cookie set above.

```ts
function requireCsrf(ctx: Ctx<Record<string, string>, unknown>): void {
  const header = ctx.headers['x-csrf-token'] ?? '';
  const cookie = parseCookies(ctx.headers.cookie ?? '').csrf ?? '';
  const a = Buffer.from(header);
  const b = Buffer.from(cookie);
  if (a.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ValidationError('invalid csrf token', []);
  }
}
```

`timingSafeEqual`, not `===`, and reject an empty token explicitly — otherwise two missing values compare equal and every unauthenticated request passes.

Double-submit relies on an attacker not being able to write your cookies. A subdomain takeover breaks that, so prefer a signed token bound to the session where the stakes are high.

## What to check regardless

- **`GET` must not change state.** A CSRF defence on unsafe methods is worthless if `GET /posts/1/delete` works. This is worth auditing: `getRoutes` prints every method and path.
- **CORS is not CSRF protection.** A permissive `access-control-allow-origin` makes things worse, but a restrictive one does not stop a form post, which needs no preflight. See [CORS](./web-cors.html).
- **Never reflect the request's `Origin`** into `access-control-allow-origin` with credentials enabled. That is equivalent to allowing every origin.

## What it would take

Two framework changes: a way for a handler or filter to set a response header (the same [handler-cannot-set-headers](./web-request-lifecycle.html) blocker that affects cookies, CORS and caching), and [guards wired into the router](./web-request-lifecycle.html) so a check applies without being called in each handler.

With those, CSRF is a `Guard` plus a token issuer — around fifty lines. Until then the origin check above is the recommendation, because for a bearer-token JSON API it is also the _correct_ answer rather than a workaround.

---

See also: [CORS](./web-cors.html) · [Cookies and Sessions](./web-cookies-sessions.html) · [Authentication](./web-authentication.html)
