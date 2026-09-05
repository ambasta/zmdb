# @zmdb/client

`@zmdb/client` is the dependency-free HTTP execution runtime for generated zmdb clients and manually declared operations. It owns transport injection, deterministic URL assembly, bounded response
decoding, cancellation, authentication patches, and stable protocol errors without importing the web framework, reflection, OpenAPI, or Node built-ins.

## Install

```bash
npm add @zmdb/client@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. The runtime uses web-platform APIs and works with either an injected transport
> or Fetch.

## Entry points

- `@zmdb/client` — generated-operation ABI, runtime, and the body/URL primitives used by generated modules.
- `@zmdb/client/body` — request-body preparation helpers and response limits.
- `@zmdb/client/errors` — stable client error classes.
- `@zmdb/client/headers` — header normalisation and conflict-safe merging.
- `@zmdb/client/transport` — structural transport types and the Fetch adapter.
- `@zmdb/client/url` — RFC 3986 component, path, query, and base-URL helpers.
- `@zmdb/client/testing` — deterministic held-request transport.

## Generated clients

`zmdb client generate` loads configured `@zmdb/web` contract exports once and writes both OpenAPI JSON and a typed TypeScript client. Commit both outputs and use `zmdb client generate --check` in CI
to reject stale output.

The generated module imports only `@zmdb/client`, so the same source can be bundled for a browser or run under Node:

```ts
import { createApiClient } from './generated/http-client.generated.js';

const api = createApiClient({
  baseUrl: 'https://api.example.com',
  authentication: () => ({
    requirement: 0,
    headers: { authorization: 'Bearer token' },
  }),
});
```

The repository's packed-consumer fixture installs only the packed `@zmdb/client` package and exercises the same generated client in browser and Node bundles against a real `@zmdb/web` service,
including alternate success status, response validation, and authentication injection.

## Documentation

Full project documentation is at **https://ambasta.github.io/zmdb/**.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later).
