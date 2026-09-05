zmdb has two deliberately separate HTTP client paths:

- APIs declared with `@zmdb/web/contract` can emit an exact typed client module. The generated module imports only the dependency-free `@zmdb/client` runtime and validates successful JSON responses
  with precomputed AOT code.
- Unrelated third-party APIs have no generic `HttpService`, Axios wrapper, or `HttpModule`. Use `fetch` or a small provider that owns that upstream's policy.

## Generate a client from `HttpContractIR`

The current generation boundary is a build-tool API:

```ts
import { writeFile } from 'node:fs/promises';

import type { HttpContractIR } from '@zmdb/web/contract';
import { generateHttpClient } from '@zmdb/web/contract/compiler';

export async function writeHttpClient(contract: HttpContractIR): Promise<void> {
  const generated = generateHttpClient(contract);
  await Promise.all([writeFile('src/http-client.generated.ts', generated.source), writeFile('src/http-client.generated.ts.map', generated.sourceMap)]);
}
```

The result is stable for the same contract and generator version. Each operation gets an exact input type, exact successful-status result type, typed documented errors, request encoding, response
dispatch, and straight-line validation. Unsupported contract or `TypeIR` shapes fail generation instead of widening to `unknown`.

Use the generated factory with an injected transport or the default Fetch transport:

```ts
import { createApiClient } from './http-client.generated.js';

const api = createApiClient({
  baseUrl: 'https://api.example.com',
  authentication: () => ({
    requirement: 0,
    headers: { authorization: `Bearer ${process.env.API_TOKEN ?? ''}` },
  }),
});
```

Generation does not embed the base URL or credentials. Authentication is resolved for each call by `@zmdb/client`.

## A typed client for a third-party API

```ts
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async get<T>(path: string, validate: (raw: unknown) => T): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`${response.status} ${path}`);
    return validate(await response.json());
  }
}
```

```ts
const user = await client.get('/users/1', raw => assert<ExternalUser>(raw));
```

The `validate` parameter is the important part. A remote API's response is untrusted input in exactly the way a request body is — the provider ships a change, a field goes null, and without a check
you get `undefined` three layers down instead of an error at the boundary. Passing `assert<T>` costs one argument.

## Register it as a provider

```ts
export const API = createToken<ApiClient>('API');

@Module({
  providers: [{ token: API, useFactory: () => new ApiClient(env.API_URL, env.API_TOKEN) }],
})
export class HttpModule {}
```

```ts
@Controller('/sync')
export class SyncController {
  @Inject(API) private readonly api!: ApiClient;
}
```

Behind a token, so tests substitute a fake with no network:

```ts
const app = createTestApp(AppModule, {
  overrides: [{ token: API, useValue: { get: async () => ({ id: 1, name: 'test' }) } }],
});
```

That is the whole reason to wrap `fetch` in a class rather than calling it inline — it makes the dependency injectable and therefore testable.

## Always set a timeout

`fetch` has no default timeout. A hung upstream holds your request until the client gives up, and under load that exhausts your concurrency.

```ts
signal: AbortSignal.timeout(5_000);
```

Combine with a caller's signal when you have one:

```ts
signal: AbortSignal.any([AbortSignal.timeout(5_000), external]);
```

An aborted outbound HTTP call is not automatically coupled to a database query it triggered. Pass the same signal into the repository read; the bundled Postgres driver can then cancel the backend when
configured with `cancelVia`. See [Query Cancellation](./query-cancellation.html).

## Retries, for the errors worth retrying

```ts
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i += 1) {
    try {
      return await fn();
    } catch (error) {
      if (i >= attempts - 1 || !retryable(error)) throw error;
      await new Promise(r => setTimeout(r, 2 ** i * 100 + Math.random() * 100));
    }
  }
}

const retryable = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || /5\d\d/.test(e.message));
```

The jitter is not decoration: without it, every instance retries in lockstep and you turn a brief upstream blip into a synchronised thundering herd.

Never retry a non-idempotent `POST` blindly. Send an idempotency key and let the upstream deduplicate, or only retry on a timeout where you know the request did not land — and remember that a timeout
does not tell you that.

## Do not log the response body

```ts
console.log({ url: path, status: response.status, ms }); // fine
console.log(await response.text()); // logs whatever the upstream returned
```

An upstream response routinely contains personal data and sometimes tokens. Log the status, the duration and the path; never the body, and never the `authorization` header you sent.

## Circuit breaking

If an upstream is down, failing fast beats queueing:

```ts
let failures = 0;
let openUntil = 0;

async function call<T>(fn: () => Promise<T>): Promise<T> {
  if (Date.now() < openUntil) throw new Error('circuit open');
  try {
    const out = await fn();
    failures = 0;
    return out;
  } catch (error) {
    if (++failures >= 5) openUntil = Date.now() + 10_000;
    throw error;
  }
}
```

Per process, so with several replicas each learns independently. Good enough, and much better than nothing.

## Calling your own API

Do not. If two controllers in one application need the same logic, extract a service and inject it — an internal HTTP round trip adds latency, a serialisation boundary and a failure mode for no
benefit.

```ts
// instead of fetch('http://localhost:3000/posts')
@Inject(POSTS) private readonly posts!: PostRepo;
```

## Server-side request forgery

If any part of the URL comes from user input, you have an SSRF vector — a request to `http://169.254.169.254/` will happily return cloud instance credentials.

```ts
const ALLOWED = new Set(['api.partner.com', 'cdn.partner.com']);

function safeUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== 'https:' || !ALLOWED.has(url.hostname)) throw new ValidationError('url not allowed', []);
  return url;
}
```

Allow-list the host; do not block-list. And do not follow redirects when the target is user-influenced (`redirect: 'manual'`) — a permitted host can redirect you to a forbidden one, which defeats a
check performed only on the original URL.

---

See also: [Configuration](./configuration.html) · [Testing Applications](./web-testing.html) · [Query Cancellation](./query-cancellation.html)
