# @zmdb/app

The protocol-neutral application kernel for zmdb. It owns Stage-3 metadata, dependency injection, modules, lifecycle, transport-neutral messaging, command applications, events, CQRS, state machines,
health contracts, and dependency-free observability ports.

For the cohesive server product, install `@zmdb/core` and use `@zmdb/core/app` for application concerns. The [server journey](https://ambasta.github.io/zmdb/docs/web-overview.html) combines HTTP and
selected jobs under this lifecycle.

## Advanced: install the kernel alone

```bash
yarn add @zmdb/app@1.0.0-beta.2
```

The package is ESM-only and requires Node.js 26 or later.

## Entry points

`@zmdb/app`, `@zmdb/app/commands`, `@zmdb/app/cqrs`, `@zmdb/app/data`, `@zmdb/app/di`, `@zmdb/app/events`, `@zmdb/app/health`, `@zmdb/app/lifecycle`, `@zmdb/app/messaging`, `@zmdb/app/modules`,
`@zmdb/app/observability`, and `@zmdb/app/state`.

HTTP adapters live in `@zmdb/web`. Queues and scheduling live in `@zmdb/jobs`; concrete broker integrations remain separately installed and implement the public `@zmdb/app/messaging` strategy
contract.

## License

Mozilla Public License 2.0 (MPL-2.0).
