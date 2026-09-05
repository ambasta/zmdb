The `helmet` analogue — a small [Interceptor](./web-middleware.html) that merges hardening headers onto every response. No global plugin; it's one composable link so you can see exactly what's set.

## A helmet-equivalent interceptor

```ts
import type { Interceptor } from '@zmdb/web/middleware';

const secure: Interceptor = {
  async intercept(ctx, next) {
    const res = await next();
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
  },
};
```

## Design notes

- Headers are merged on unwind, so a handler can still override a specific one.
- CSP/HSTS values are yours to tune — nothing is silently defaulted behind your back.

## Cross-links

- [CORS](./web-cors.html) · [Middleware](./web-middleware.html) · [Request pipeline](./web-pipeline.html)
