Cookies are **read** in a handler from `ctx.headers.cookie`, and **set** by returning a response that carries `set-cookie`. There is no session middleware; a session store is a provider you inject.

## Reading a cookie

```ts {"mode":"compile","id":"example-001"}
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

```ts {"mode":"illustrative","id":"example-002","reason":"This decorator or member excerpt omits its containing class and the application-owned declarations it uses."}
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

Return the cookie from the login handler. `json`, `text` and `respond` all take response headers, and the router passes a response they built through untouched:

```ts {"mode":"illustrative","id":"example-003","reason":"This decorator or member excerpt omits its containing class and the application-owned declarations it uses."}
@Post('/login')
async login(ctx: Ctx<Record<never, string>, Credentials>) {
  const sid = await this.sessions.create(await this.users.authenticate(ctx.body));
  return json({ ok: true }, {
    headers: { 'set-cookie': `sid=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800` },
  });
}
```

Log out the same way, with an expired cookie: `sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`. The attributes on the clearing cookie must match the ones it replaces, or the browser keeps
both.

**One `set-cookie` per response.** `WebResponse.headers` is a `Record<string, string>`, and `set-cookie` is the one header that cannot be safely folded into a single comma-separated value. If a
response genuinely needs to set two cookies, the adapter has to append the second — but the case is rare enough that reaching for it is usually a sign the second value belongs in the session record
instead.

A bearer token in the `Authorization` header remains a reasonable alternative, and avoids [CSRF](./web-csrf.html) entirely rather than mitigating it with `SameSite`.

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

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies Session; this excerpt does not repeat those declarations."}
import { createToken } from '@zmdb/app/di';

export interface SessionStore {
  load(sid: string): Promise<Session | undefined>;
  create(userId: number): Promise<string>;
  destroy(sid: string): Promise<void>;
}

export const SESSIONS = createToken<SessionStore>('SESSIONS');
```

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies AuthController, Module, RedisSessionStore, SESSIONS, env; this excerpt does not repeat those declarations."}
@Module({
  providers: [{ token: SESSIONS, useFactory: () => new RedisSessionStore(env.REDIS_URL) }],
  controllers: [AuthController],
})
export class AuthModule {}
```

```ts {"mode":"illustrative","id":"example-006","reason":"The surrounding example supplies Controller, Inject, SESSIONS, SessionStore; this excerpt does not repeat those declarations."}
@Controller('/auth')
export class AuthController {
  @Inject(SESSIONS) private readonly sessions!: SessionStore;
}
```

`@Inject` is a **field** decorator — `container.build` calls `new Ctor()`, so constructor injection does not exist. See [Dependency Injection](./web-di.html).

Behind a token, so a test substitutes an in-memory store:

```ts {"mode":"illustrative","id":"example-007","reason":"The surrounding example supplies AppModule, MemoryStore, SESSIONS, createTestApp; this excerpt does not repeat those declarations."}
createTestApp(AppModule, { overrides: [{ token: SESSIONS, useValue: new MemoryStore() }] });
```

## Session ids

```ts {"mode":"illustrative","id":"example-008","reason":"The surrounding example supplies randomBytes; this excerpt does not repeat those declarations."}
const sid = randomBytes(32).toString('base64url');
```

`randomBytes`, never `Math.random()` — predictable session ids have been the root cause of many account-takeover vulnerabilities.

Store a **hash** of the id, so a database leak does not hand over live sessions. Rotate the id on login and on privilege change, or a session fixated before authentication remains valid after it.

Set an absolute expiry as well as an idle one. A session that refreshes forever never expires, which turns one stolen cookie into permanent access.

## Sessions in the database

If you already have Postgres, you do not need Redis:

```ts {"mode":"compile","id":"example-009"}
import type { PrimaryKey, References, Serial, Sql, Table } from '@zmdb/core/tags';

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
