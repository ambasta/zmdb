# @zmdb/transport-redis

`@zmdb/transport-redis` is the explicit Redis Pub/Sub transport for `@zmdb/app/messaging`.

It is intentionally non-durable: publishing without a connected subscriber loses the message. The strategy reports `redelivery: false`, `deadLetter: false`, and `requestResponse: true`, so application
startup requires an `onUndeliverable` sink.

## Install

```bash
npm add @zmdb/transport-redis@alpha redis@^6.2.1
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

The sole peer is `redis@^6.2.1`. Neither it nor this package is installed by `npm add zmdb@alpha`.

## Usage

```ts
import { transportExtension } from '@zmdb/app/messaging';
import { createRedisStrategy } from '@zmdb/transport-redis';

const connection = process.env.REDIS_URL;
if (connection === undefined) throw new Error('REDIS_URL is required');

const redis = createRedisStrategy({
  connection: { url: connection },
  channels: ['orders.get'],
  channelPatterns: ['orders.events.*'],
  onError: error => console.error(error),
});

const extension = transportExtension({
  transports: [redis],
  dispatcher: {
    onUnhandled: message => console.warn('unhandled', message.pattern),
    onInvalidPayload: (message, error) => console.error('invalid', message.pattern, error),
    onHandlerError: (message, error) => console.error('handler', message.pattern, error),
    onUndeliverable: (message, settlement) => console.error('dropped', message.pattern, settlement),
  },
});

void extension;
```

Exact channels and Redis glob subscriptions dispatch the concrete delivered channel. Requests use a generated process-owned reply-channel prefix and the correlation id supplied by the app messaging
client.

`transportExtension` owns startup and bounded shutdown. The strategy creates separate publisher and subscriber clients, unsubscribes, drains accepted dispatches, then closes both clients.

## Entry points

- `@zmdb/transport-redis` — `createRedisStrategy` and `RedisStrategyOptions`.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
