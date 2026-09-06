# @zmdb/transport-nats

`@zmdb/transport-nats` connects the public `@zmdb/app/messaging` transport strategy contract to core NATS.

It supports native `*` and final-`>` subjects, queue groups, one-way events, request/reply, cancellation, deadlines, and bounded shutdown. It does not imply JetStream durability or own a
process-global connection.

## Install

```bash
npm add @zmdb/transport-nats@alpha @nats-io/transport-node@^3.4.0
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

The sole peer is `@nats-io/transport-node@^3.4.0`. Neither it nor this package is installed by `npm add zmdb@alpha`.

## Usage

```ts
import { transportExtension } from '@zmdb/app/messaging';
import { createNatsStrategy } from '@zmdb/transport-nats';

const connection = process.env.NATS_URL;
if (connection === undefined) throw new Error('NATS_URL is required');

const nats = createNatsStrategy({
  connection: { servers: connection },
  subscriptions: [{ subject: 'orders.*', queue: 'orders-workers' }],
  onError: error => console.error(error),
});

const extension = transportExtension({
  transports: [nats],
  dispatcher: {
    onUnhandled: message => console.warn('unhandled', message.pattern),
    onInvalidPayload: (message, error) => console.error('invalid', message.pattern, error),
    onHandlerError: (message, error) => console.error('handler', message.pattern, error),
    onUndeliverable: (message, settlement) => console.error('dropped', message.pattern, settlement),
  },
});

void extension;
```

Core NATS is at-most-once. `redelivery` and `deadLetter` are therefore `false`, so an application attaching this strategy must provide `dispatcher.onUndeliverable`.

`transportExtension` starts the strategy, stops intake, waits for accepted dispatches within the application grace budget, drains the NATS connection, and closes it. The strategy creates no
process-global connection.

## Entry points

- `@zmdb/transport-nats` — `createNatsStrategy`, `NatsStrategyOptions`, and `NatsSubscription`.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
