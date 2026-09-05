# @zmdb/app

The protocol-neutral application kernel for zmdb. It owns Stage-3 metadata, dependency injection, modules, lifecycle, transport-neutral messaging, command applications, events, CQRS, state machines,
health contracts, and dependency-free observability ports.

## Install

```bash
npm add @zmdb/app@alpha
```

The package is ESM-only and requires Node.js 26 or later.

## Entry points

`@zmdb/app`, `@zmdb/app/commands`, `@zmdb/app/cqrs`, `@zmdb/app/data`, `@zmdb/app/di`, `@zmdb/app/events`, `@zmdb/app/health`, `@zmdb/app/lifecycle`, `@zmdb/app/messaging`, `@zmdb/app/modules`,
`@zmdb/app/observability`, and `@zmdb/app/state`.

HTTP adapters live in `@zmdb/web`. Queues and scheduling will live in `@zmdb/jobs`; concrete broker integrations remain separately installed and implement the public `@zmdb/app/messaging` strategy
contract.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later).
