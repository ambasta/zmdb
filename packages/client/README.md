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

- `@zmdb/client` — generated-operation ABI and runtime.
- `@zmdb/client/body` — request-body preparation helpers and response limits.
- `@zmdb/client/errors` — stable client error classes.
- `@zmdb/client/headers` — header normalisation and conflict-safe merging.
- `@zmdb/client/transport` — structural transport types and the Fetch adapter.
- `@zmdb/client/url` — RFC 3986 component, path, query, and base-URL helpers.
- `@zmdb/client/testing` — deterministic held-request transport.

## Documentation

Full project documentation is at **https://ambasta.github.io/zmdb/**.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later).
