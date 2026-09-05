# @zmdb/transport-nats

`@zmdb/transport-nats` connects the public `@zmdb/app/messaging` transport strategy contract to core NATS.

It supports native `*` and final-`>` subjects, queue groups, one-way events, request/reply, cancellation, deadlines, and bounded shutdown. It does not imply JetStream durability or own a
process-global connection.

## Install

```bash
npm add @zmdb/transport-nats@alpha @nats-io/transport-node
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Usage

```ts
import { transportExtension } from '@zmdb/app/messaging';
import { createNatsStrategy } from '@zmdb/transport-nats';

const nats = createNatsStrategy({
  connection: { servers: process.env.NATS_URL },
  subscriptions: [{ subject: 'orders.*', queue: 'orders-workers' }],
  onError: error => transportErrors.report(error),
});

const extension = transportExtension({
  transports: [nats],
  dispatcher: {
    onUnhandled: message => audit.unhandled(message),
    onInvalidPayload: (message, error) => audit.invalid(message, error),
    onHandlerError: (message, error) => audit.failed(message, error),
    onUndeliverable: (message, settlement) => audit.dropped(message, settlement),
  },
});
```

Core NATS is at-most-once. `redelivery` and `deadLetter` are therefore `false`, so an application attaching this strategy must provide `dispatcher.onUndeliverable`.

## Entry points

- `@zmdb/transport-nats` — `createNatsStrategy`, `NatsStrategyOptions`, and `NatsSubscription`.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
