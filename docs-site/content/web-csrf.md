> **ToDo / feature gap.** There is no CSRF protection — no token middleware, no
> `csurf` equivalent, no double-submit helper.
>
> The threat model and the token strategy are frozen in
> `packages/web/src/csrf/SPEC.md`. A handler **can** set a response header —
> `json()` and `respond()` both take one, and an earlier version of this page said
> otherwise, which is why it thought a token could not be delivered.

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

function requireSameOrigin(ctx: Ctx<Record<string, string>, unknown>): WebResponse | undefined {
  if (ctx.method === 'GET' || ctx.method === 'HEAD') return undefined;
  const origin = ctx.headers.origin ?? ctx.headers.referer;
  if (origin === undefined || !SAFE.has(new URL(origin).origin)) {
    return respond({ status: 403, body: '' });
  }
  return undefined;
}
```

A CSRF rejection is a **403**, and `return respond({ status: 403 })` from the handler is the only
way to produce one today: the pipeline maps a thrown `ValidationError` to 400 and anything else to
500, and it never reads `ChainError.status`. So the check returns a response rather than throwing,
and the handler returns it if there is one.

Browsers set `Origin` on every cross-origin state-changing request and it cannot be forged by page JavaScript. Reject a missing origin on unsafe methods rather than allowing it — a permissive fallback defeats the check, and legitimate browser requests always include it.

Requiring `content-type: application/json` helps too: a cross-site form post cannot set it, and a browser will not send a JSON preflight without CORS permission.

## Double-submit tokens

When you need a token — a cookie-authenticated app supporting older browsers:

```ts
@Post('/csrf')
issue() {
  const token = crypto.getRandomValues(new Uint8Array(32)).toBase64({ alphabet: 'base64url', omitPadding: true });
  return json(
    { token },
    { headers: { 'set-cookie': `csrf=${token}; Secure; SameSite=Lax; Path=/` } },
  );
}
```

The client stores it and sends it as `x-csrf-token` on every mutation; you compare it against the same value in the non-`HttpOnly` cookie set above.

> [!WARNING]
> `WebResponse.headers` is `Readonly<Record<string, string>>`, so **exactly one `set-cookie` per
> response** is representable. A login route that rotates the session cookie _and_ issues a CSRF
> cookie cannot be written with today's response type — which is precisely the route a reader of
> this page is writing. That is one more reason the freeze issues no CSRF cookie at all.

```ts
const compareKey = await crypto.subtle.importKey(
  'raw',
  crypto.getRandomValues(new Uint8Array(32)), // per process, never leaves it
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);
const digest = async (value: string): Promise<string> =>
  new Uint8Array(await crypto.subtle.sign('HMAC', compareKey, new TextEncoder().encode(value))).toBase64();

async function requireCsrf(ctx: Ctx<Record<string, string>, unknown>): Promise<WebResponse | undefined> {
  const header = ctx.headers['x-csrf-token'] ?? '';
  const cookie = parseCookies(ctx.headers.cookie ?? '').csrf ?? '';
  if (header === '' || (await digest(header)) !== (await digest(cookie))) {
    return respond({ status: 403, body: '' });
  }
  return undefined;
}
```

Reject an empty token explicitly, or two missing values compare equal and every unauthenticated request passes.

**That is a double-HMAC comparison, not `timingSafeEqual`, and the substitution is deliberate.** `.oxlintrc.json` bans importing `node:crypto` in this repository's own source ("Use
`globalThis.crypto` and the Web Crypto API") — your application may import it, but the framework
cannot ship the comparison — Web Crypto has no constant-time comparison primitive, and a hand-rolled XOR-accumulate loop's constant-timeness is a property of the JIT rather than of the source — so it cannot be asserted by a test. MAC both sides under a random per-process key and compare the digests with `===`: an attacker cannot steer a digest they cannot predict, so the comparison's timing carries no information. This removes the requirement instead of trying to satisfy it, and it is what the freeze specifies.

Double-submit relies on an attacker not being able to write your cookies, and the freeze does not use it for exactly that reason — a subdomain takeover, a compromised sibling application, or one plaintext response on any `*.example.com` host is enough, because cookies ignore the origin's scheme and port. What ships instead is a **stateless token bound to the session**:

```
nonce ‖ '.' ‖ base64url(HMAC-SHA256(secret, sessionId ‖ '.' ‖ nonce))
```

Verification recomputes the MAC over the session id taken from the request's own session, so a cookie the attacker can write is useless — they cannot produce a MAC for _your_ session. There is no CSRF cookie at all, which removes a second `SameSite`, `Secure`, `Path` and `Domain` to get wrong, and no server-side store, which is what a synchroniser token would have needed. The token has no separate expiry: its lifetime is the session's, because the session id is inside the MAC, so a login that rotates the session — where session fixation lives — rotates the token automatically.

The issued token **will also be masked per response** with a fresh random value (frozen, #565). That adds no secrecy; it makes the bytes of the response different every time, which removes the [BREACH](./web-compression.html) side channel structurally rather than by remembering an exclusion rule.

## What to check regardless

- **`GET` must not change state.** A CSRF defence on unsafe methods is worthless if `GET /posts/1/delete` works. This is worth auditing: `getRoutes(Controller)` returns every method and path declared on one
  controller, so the audit is a loop over your controller list. There is no route-table
  introspection on `Router`.
- **CORS is not CSRF protection.** A permissive `access-control-allow-origin` makes things worse, but a restrictive one does not stop a form post, which needs no preflight. See [CORS](./web-cors.html).
- **Never reflect the request's `Origin`** into `access-control-allow-origin` with credentials enabled. That is equivalent to allowing every origin.

## What it does not protect

Worth stating as plainly as the freeze does, because a CSRF token in an audit looks like more than it is.

- **XSS.** A script on your origin reads any token your page can read and sets any header your page can set. CSRF protection assumes the origin is not compromised. A missing escape is not a CSRF problem and no token configuration fixes it.
- **A stolen session cookie.** The attacker replays the session directly.
- **Network interception.** That is TLS's job.
- **Clickjacking.** The user makes the request themselves, on your origin, with a valid token. `frame-ancestors` is the control.
- **A mutating `GET`.** Bypasses every method-based defence there is, including this one.

## What it would take

One framework change, not two. A handler can already set a response header, so what is left is [guards wired into the router](./web-request-lifecycle.html) so a check applies without being called in each handler — which makes this **blocked in fact on the guards work**, even though no dependency edge records it. `Guard.canActivate` exists and `runChain` has no caller in the pipeline yet, so until that lands `verify(ctx)` at the top of a handler is the only working form.

The surface is `createCsrf({ secret, sessionOf, allowedOrigins })`, which is `async` — it returns
a `Promise<Csrf>`, because importing the HMAC key is async — resolving to `issue`, `verify` and
`guard()`. Two things about it are there to prevent protection theatre rather than to be convenient:

**`sessionOf` is required**, and `issue` and `verify` both **throw** when it returns `undefined`. A developer installing this on a bearer-token API has to write a function answering "which cookie session is this", discovers there is not one, and gets an error instead of a middleware that passes every request while looking like a control. A required argument that cannot be answered is a better warning than a paragraph of documentation.

**The origin check is part of `verify`, not an alternative to it.** It costs one comparison, needs no token endpoint, and catches the case where a token leaked. `allowedOrigins` is required with no default and no wildcard, and the request's own `Origin` is never reflected.

For a bearer-token JSON API the origin check above remains not just the workaround but the _correct_ answer, which is why the first section of this page comes before this one.

---

See also: [CORS](./web-cors.html) · [Cookies and Sessions](./web-cookies-sessions.html) · [Authentication](./web-authentication.html)
