`policy.securityHeaders` sets hardening headers on every response the router produces, including error responses. It is a plain record of header name to value, so nothing is defaulted behind your back
— the headers you write are the headers you get.

## Configure the policy

```ts {"mode":"compile","id":"example-001"}
import { createRouter, type HttpPolicy } from '@zmdb/web';

const policy: HttpPolicy = {
  securityHeaders: {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'content-security-policy': "default-src 'self'",
  },
};

const router = createRouter({ policy });
```

`createApp` takes the same `policy` option, and CORS lives in the same object — see [CORS](./web-cors.html). The two are independent: a policy may configure either, or both.

## The policy wins over the handler

A configured header overrides whatever a handler set. This is the opposite of a merge-behind wrapper, and it is deliberate: a hardening header that any route can weaken by accident is not a policy.

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies Controller, Get, text; this excerpt does not repeat those declarations."}
@Controller('/report')
class ReportController {
  @Get()
  get() {
    // The policy above sends DENY. This SAMEORIGIN does not survive.
    return text('...', { headers: { 'x-frame-options': 'SAMEORIGIN' } });
  }
}
```

When a route genuinely needs to own a header, set that entry to `false` instead of removing it. A `false` entry is not sent by the policy, so the handler's value survives — and the key stays in the
record as a record of the decision:

```ts {"mode":"compile","id":"example-003"}
import type { HttpPolicy } from '@zmdb/web';

const policy: HttpPolicy = {
  securityHeaders: {
    'x-content-type-options': 'nosniff',
    // The embed route sets its own frame policy; see ReportController.
    'x-frame-options': false,
  },
};
```

Every header the policy does not mention is left alone in either direction.

## Invalid headers fail at startup

A malformed header name or a value containing a newline throws from `createRouter`, not on the request that would have carried it:

```ts {"mode":"compile","id":"example-004"}
import { createRouter } from '@zmdb/web';

// 'bad name' is not a valid header name.
createRouter({ policy: { securityHeaders: { 'bad name': 'value' } } }); // throws

// The value carries a newline, which is how header injection is attempted.
createRouter({ policy: { securityHeaders: { 'content-security-policy': "default-src 'self'\nx: y" } } }); // throws
```

Header injection through a configured value is therefore not reachable, and a typo is a boot failure rather than a header that silently never appears.

## What to set

The five headers in the first example are a reasonable baseline for a JSON API. Two of them need thought before production:

- **`strict-transport-security`** tells browsers to refuse plain HTTP for your domain for the stated period. Ship a short `max-age` first and raise it once you are sure every subdomain terminates TLS;
  `includeSubDomains` is not reversible within the cached period.
- **`content-security-policy`** is worth writing properly for anything that serves HTML, and `default-src 'self'` will break inline scripts and styles. For a pure JSON API the value costs nothing and
  closes off the case where a response is somehow rendered as a document.

`x-content-type-options: nosniff`, `x-frame-options: DENY` and `referrer-policy: no-referrer` are safe to set unconditionally on an API.

## Design notes

- Headers are applied after routing and after CORS, so they cover handler responses, thrown errors, and the `413` a request over `maxBodyBytes` receives.
- Names are normalised to lower case on the wire; write them in whichever case you prefer.
- The policy is one object per router, evaluated once when the router is built. There is no per-route registration and no ordering to reason about.

## Cross-links

- [CORS](./web-cors.html) · [Middleware](./web-middleware.html) · [Request pipeline](./web-pipeline.html)
