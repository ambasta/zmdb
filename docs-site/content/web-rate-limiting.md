There is no `ThrottlerModule`. A limiter is a counter keyed on something you choose, plus a decision — and the recommendation is to put it in front of your process, not inside it.

## The layer question first

| Layer                       | Sees                              | Good for                             |
| --------------------------- | --------------------------------- | ------------------------------------ |
| CDN / WAF                   | every request, before your origin | volumetric abuse, bad bots           |
| Reverse proxy (`limit_req`) | every request to this host        | per-IP ceilings                      |
| In your handler             | the authenticated principal       | per-account and per-operation limits |

The first two protect you from traffic that would otherwise cost you a process. Only the third can express "this account may send five password resets an hour", because only your code knows who is
asking. Use both; they are not substitutes.

## In your handler

```ts
export interface CounterStore {
  incr(key: string, windowMs: number): Promise<number>;
}

export class TooManyRequests extends Error {
  override readonly name = 'TooManyRequests';
}

export async function limit(store: CounterStore, key: string, max: number, windowMs: number): Promise<void> {
  const count = await store.incr(key, windowMs);
  if (count > max) throw new TooManyRequests(key);
}
```

```ts
@Post('/password-reset')
async reset(ctx: Ctx<Record<never, string>, { email: string }>) {
  await limit(this.counters, `reset:${ctx.body.email}`, 5, 3_600_000);
  await limit(this.counters, `reset-ip:${clientIp(ctx)}`, 20, 3_600_000);
  return this.passwords.sendReset(ctx.body.email);
}
```

Two keys, deliberately: per-account so one address cannot be spammed, per-IP so one client cannot walk a list of addresses. A single key on either axis is bypassable by moving along the other.

A thrown `TooManyRequests` remains an ordinary error and becomes a 500 unless an adapter maps it. A handler can instead return `json(value, { status: 429, headers: { 'retry-after': seconds } })`. Send
`retry-after`; a client that does not know when to retry retries immediately.

## As a Guard

```ts
import type { Guard, AnyCtx } from '@zmdb/web/middleware';

export function rateLimit(store: CounterStore, max: number, windowMs: number): Guard {
  return {
    async canActivate(ctx: AnyCtx): Promise<boolean> {
      return (await store.incr(`${ctx.method}:${ctx.path}:${clientIp(ctx)}`, windowMs)) <= max;
    },
  };
}
```

Pass it through `GuardRegistry.app` for every registered route, `GuardRegistry.controllers` for one controller, or `RouteOptions.guards` for one handler. Effective guards run app → controller → route
before the handler:

```ts
const router = createRouter({
  guardRegistry: { app: [rateLimit(counters, 100, 60_000)] },
});
```

A rejected guard currently returns 403; a limiter that must return 429 still needs a handler or adapter response.

## Identifying the caller

```ts
function clientIp(ctx: AnyCtx): string {
  const forwarded = ctx.headers['x-forwarded-for'];
  return forwarded === undefined ? 'unknown' : (forwarded.split(',').at(-TRUSTED_HOPS)?.trim() ?? 'unknown');
}
```

> [!WARNING] `x-forwarded-for` is a client-settable header. Taking the **first** entry lets any caller send `x-forwarded-for: 1.2.3.4` and reset their own bucket — or, worse, exhaust someone else's.
> Count back from the right by the number of proxies you actually run, and only trust the header at all when the connection came from one of them. With no proxy in front, use the socket address and
> ignore the header.

Prefer the authenticated principal where you have one: an account id cannot be spoofed, does not change on a phone switching networks, and is not shared by an entire office behind one NAT.

## Storing the counters

**In-process, for a single instance:**

```ts
export function memoryCounters(): CounterStore {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async incr(key, windowMs) {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (bucket === undefined || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return 1;
      }
      bucket.count += 1;
      return bucket.count;
    },
  };
}
```

Correct and fast, with two practical limits: it is **per instance**, so N replicas give a caller N times the limit; and the `Map` grows with distinct keys, so sweep expired entries on an interval or
it is a memory leak — an unbounded map keyed by attacker-controlled input is itself the vulnerability.

**Redis, for more than one instance:** `INCR` then `EXPIRE` on first increment, in one round trip. Shared state, survives a restart, and one more dependency to be down — decide what happens when it
is. Failing open keeps the site up and drops the limit; failing closed does the opposite. For login attempts, fail closed.

**Postgres, if you already have it:** a counters table with an upsert is fine at modest rates and saves running Redis. It puts write load on your primary, so keep the window coarse.

## Fixed window or sliding

A fixed window is what the code above implements: simple, and it permits a burst of `2 × max` across a boundary. Usually irrelevant. When it is not, keep a sorted set of timestamps (sliding log —
exact, more memory) or a token bucket (smooth, one counter plus a timestamp). Pick the simplest that meets the requirement, and write down which one you picked, because the boundary burst surprises
people during an incident.

## What to limit, and what not to

Limit what is expensive or security-relevant: login, password reset, signup, invitations, exports, search, anything sending email or calling a paid API. Do not put a global limiter on ordinary reads
at a level that a legitimate single-page app trips on its first render — the support cost exceeds the benefit, and the CDN is the right layer for volumetric protection anyway.

Return the limit state in headers (`ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`) from your adapter so clients can back off cooperatively.

## Testing

Inject the store, so a test drives the clock rather than sleeping:

```ts
await using app = createTestApp(AppModule, {
  overrides: [{ token: COUNTERS, useValue: memoryCounters() }],
});

for (let i = 0; i < 5; i += 1) expect((await post('/password-reset')).status).toBe(200);
expect((await post('/password-reset')).status).not.toBe(200);
```

Assert the limit **and** the reset. A limiter that never resets is an outage.

## What it would take

Application/controller-level registration now applies a limiter across an explicitly constructed router. A status other than 403 from a rejected guard is still needed. Limit headers likewise need a
handler/adapter response.

---

See also: [Authentication](./web-authentication.html) · [Middleware](./web-middleware.html) · [Security Headers](./web-security-headers.html)
