A small response wrapper merges hardening headers after the router has serialized the handler result. Pass the wrapped handler to your HTTP adapter.

## Wrap the router response

```ts {"mode":"compile","id":"example-001"}
import type { WebRequest, WebResponse } from '@zmdb/web';

export function withSecurityHeaders(handle: (request: WebRequest) => Promise<WebResponse>) {
  return async (request: WebRequest): Promise<WebResponse> => {
    const res = await handle(request);
    return {
      ...res,
      headers: {
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'content-security-policy': "default-src 'self'",
        ...res.headers,
      },
    };
  };
}
```

## Design notes

- Headers are merged after routing, so a handler can still override a specific one.
- CSP/HSTS values are yours to tune — nothing is silently defaulted behind your back.

## Cross-links

- [CORS](./web-cors.html) · [Middleware](./web-middleware.html) · [Request pipeline](./web-pipeline.html)
