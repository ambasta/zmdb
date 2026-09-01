`ExceptionFilter` exists as an interface, and `runChain` calls filters when the handler or an earlier link throws. What does **not** exist is the wiring: the router never calls `runChain`, so a filter's response cannot reach the client unless you invoke the chain yourself.

## The interface

```ts
export interface ExceptionFilter {
  catch(error: unknown, ctx: Ctx): WebResponse | undefined;
}
```

Returning `undefined` means "not mine" — the next filter gets a chance, and if none handles it the error propagates.

```ts
import type { ExceptionFilter, WebResponse } from '@zmdb/web/middleware';

export const dbErrors: ExceptionFilter = {
  catch(error) {
    if (!isUniqueViolation(error)) return undefined;
    return { status: 409, body: JSON.stringify({ error: 'already exists' }), headers: {} };
  },
};
```

Note `body` is a **`string`** — `WebResponse.body` is not an object. Stringify it yourself.

## The gap you must plan around

```ts
const result = await runChain({ guards: [], pipes: [], interceptors: [], filters: [dbErrors] }, ctx, handler);
```

> [!WARNING]
> `runChain` returns the filter's `WebResponse` **as a value**, and the router then
> serialises that value as a **200**. So a filter returning `{ status: 409, … }`
> produces a 200 whose body contains the number 409. See
> [Request Lifecycle](./web-request-lifecycle.html).

A **thrown** error has four outcomes, and the status it carries is not one of the inputs:

| Status | Cause                                                 |
| ------ | ----------------------------------------------------- |
| 200    | the handler returned                                  |
| 400    | the handler threw something with an `issues` property |
| 404    | no route matched                                      |
| 500    | the handler threw anything else                       |

A handler that _returns_ `json(value, { status })`, `text(...)` or `respond(...)` picks its own status and headers — so catching an error and returning a response is the way to get a 403 or 409 today. What is still missing is the cross-cutting part: a filter that applies to every route without each handler repeating the `catch`.

## What to do today

**For a 400, throw something with `issues`.** This is the supported path and it needs no filter:

```ts
throw new ValidationError('title is required', [{ path: ['title'], message: 'required' }]);
```

`assert<T>()` throws an `AssertError` carrying an `issues` array, and the router turns **any** thrown object with an `issues` property into a 400 with those paths in the body — it duck-types rather than checking a class, so `ValidationError` from `@zmdb/schema-core` and your own error types work identically. Validating the body therefore gives you a 400 with the issue paths for free.

**For any other status, map it in your adapter.** The one place that can set a status and headers:

```ts
const STATUS = new Map<string, number>([
  ['NotFoundError', 404],
  ['UniqueViolation', 409],
  ['ForbiddenError', 403],
]);

createServer(async (req, res) => {
  try {
    const out = await app.handle(toWebRequest(req));
    res.writeHead(out.status, { ...out.headers }).end(out.body);
  } catch (error) {
    const status = STATUS.get(errorName(error)) ?? 500;
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: publicMessage(status) }));
  }
});
```

This works because `app.handle` propagates a throw it cannot classify. It is the honest workaround, and it puts the status policy in one readable table.

## Never leak the error

```ts
function publicMessage(status: number): string {
  return status === 500 ? 'internal error' : (STATUS_TEXT[status] ?? 'error');
}
```

```ts
console.error(JSON.stringify({ requestId, name: errorName(error), stack: stackOf(error) }));
```

> [!WARNING]
> A database error message contains table names, column names, constraint names and
> sometimes the offending value. Returning `String(error)` to a client discloses your
> schema and occasionally user data. Log the detail with a request id; return a
> generic message and that id.

The framework's 500 body is already generic. The mistake is adding detail to be helpful.

## Do not swallow errors

```ts
catch { return { rows: [], total: 0 }; }   // wrong
```

An empty result where an error occurred is worse than a 500: the client believes there is no data, retries nothing, and the failure never surfaces in your error rate. Let it throw, log it, alert on it.

The one legitimate exception is a genuinely optional dependency — a cache miss, an enrichment call — where degraded is a defined mode. Log at `warn` even then, so a permanently broken dependency is visible.

## Errors from a driver

zmdb does not translate driver errors. What reaches you is your client's error with its native code — `23505` on Postgres, `ER_DUP_ENTRY` on MySQL — which is deliberate: a wrapper class loses the detail and needs a mapping table that is always incomplete.

Translate at the boundary, where you know what the code should become. See [Custom Driver](./custom-driver.html).

## What it would take

Two changes, both framework-internal and neither blocked on anything else:

1. Wire `runChain` into the router, registrable per controller or per route.
2. Let a filter's returned `WebResponse` become the actual response rather than a serialised value.

Together those make the interface on this page work as designed, and they would also fix [guards](./web-middleware.html), [interceptors](./web-middleware.html), [CORS](./web-cors.html) and [health checks](./web-health-checks.html).

---

See also: [Request Lifecycle](./web-request-lifecycle.html) · [Middleware](./web-middleware.html) · [Custom Driver](./custom-driver.html)
