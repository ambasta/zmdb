Cookies can be **read** in a handler, from `ctx.headers.cookie`. They cannot be **set** from a handler — the router controls the response headers — so `set-cookie` goes in your adapter. There is no
session middleware; a session store is a provider you inject.

## Reading a cookie

```ts
export function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}
```

```ts
@Get('/me')
async me(ctx: Ctx<Record<never, string>, unknown>) {
  const sid = parseCookies(ctx.headers.cookie).sid;
  if (sid === undefined) throw new ValidationError('not authenticated', []);
  return this.sessions.load(sid);
}
```

Split on the **first** `=` only. A cookie value can contain `=` (base64 padding, for instance), and `split('=')` truncates it — which produces an intermittently invalid session id that is very hard to
debug.

## Setting one

In the Node adapter:

```ts
import { bodyText } from '@zmdb/web';

createServer(async (req, res) => {
  const out = await app.handle(await webRequest(req));
  const body = await bodyText(out);

  const cookie = pendingCookieFor(req); // however your login route signals it
  const headers = cookie === undefined ? out.headers : { ...out.headers, 'set-cookie': cookie };

  res.writeHead(out.status, headers).end(body);
});
```

`webRequest(req)` is the `WebRequest` build the adapter does itself — there is no `toWebRequest` to import; it is written out in [Request Lifecycle](./web-request-lifecycle.html). Note that it
consumes the request stream, so a login `POST` body reaches the handler only if the adapter reads it there rather than after `app.handle`.

Getting the value from the handler to the adapter is the awkward part, since there is no response object to attach it to. The workable arrangement is to have the login route return the session id in
its body and let the adapter turn that into a cookie for that one path:

```ts
const path = (req.url ?? '/').split('?')[0];
if (path === '/auth/login' && out.status === 200) {
  const { sid } = JSON.parse(body) as { sid: string };
  headers['set-cookie'] = `sid=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;
}
```

Ugly, and clear about the limitation. If cookies are central to your application, a bearer token in the `Authorization` header avoids this entirely and is the shape the framework is built for. The
custom cookie adapter buffers a streamed body; the login response is deliberately a small JSON text response.

## The attributes, and why each one

```
sid=…; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800
```

| Attribute      | Why                                                                                  |
| -------------- | ------------------------------------------------------------------------------------ |
| `HttpOnly`     | JavaScript cannot read it, so XSS cannot exfiltrate the session                      |
| `Secure`       | never sent over plaintext HTTP                                                       |
| `SameSite=Lax` | not sent on cross-site state-changing requests — the [CSRF](./web-csrf.html) defence |
| `Path=/`       | scope explicitly rather than relying on the request path                             |
| `Max-Age`      | bounded lifetime; a session cookie with no expiry lives until the browser closes     |

All five. `HttpOnly` and `Secure` are the two that turn a survivable bug into a breach.

Do not put anything but an opaque identifier in a cookie. A cookie containing a user id, a role or JSON is client-controlled data that arrives back looking authoritative — the classic privilege
escalation. If you must, sign it and verify the signature with `timingSafeEqual`.

## A session store as a provider

```ts
import { createToken } from '@zmdb/web/di';

export interface SessionStore {
  load(sid: string): Promise<Session | undefined>;
  create(userId: number): Promise<string>;
  destroy(sid: string): Promise<void>;
}

export const SESSIONS = createToken<SessionStore>('SESSIONS');
```

```ts
@Module({
  providers: [{ token: SESSIONS, useFactory: () => new RedisSessionStore(env.REDIS_URL) }],
  controllers: [AuthController],
})
export class AuthModule {}
```

```ts
@Controller('/auth')
export class AuthController {
  @Inject(SESSIONS) private readonly sessions!: SessionStore;
}
```

`@Inject` is a **field** decorator — `container.build` calls `new Ctor()`, so constructor injection does not exist. See [Dependency Injection](./web-di.html).

Behind a token, so a test substitutes an in-memory store:

```ts
createTestApp(AppModule, { overrides: [{ token: SESSIONS, useValue: new MemoryStore() }] });
```

## Session ids

```ts
const sid = randomBytes(32).toString('base64url');
```

`randomBytes`, never `Math.random()` — predictable session ids have been the root cause of many account-takeover vulnerabilities.

Store a **hash** of the id, so a database leak does not hand over live sessions. Rotate the id on login and on privilege change, or a session fixated before authentication remains valid after it.

Set an absolute expiry as well as an idle one. A session that refreshes forever never expires, which turns one stolen cookie into permanent access.

## Sessions in the database

If you already have Postgres, you do not need Redis:

```ts
import type { PrimaryKey, References, Serial, Sql, Table } from 'zmdb/tags';

export interface Session extends Table<'sessions'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  token_hash: string & Sql<'text'>;
  user_id: number & Sql<'integer'> & References<'users.id'>;
  expires_at: Date & Sql<'timestamp'>;
}
```

Create an explicit unique index on `token_hash` with `createIndexDdl`, then delete expired rows on a schedule — see [Indexes & Constraints](./indexes-constraints.html) and
[Task Scheduling](./web-task-scheduling.html). One fewer system to run, one more query per request.

---

See also: [Authentication](./web-authentication.html) · [CSRF](./web-csrf.html) · [Dependency Injection](./web-di.html)
