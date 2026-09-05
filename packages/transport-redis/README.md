# @zmdb/transport-redis

`@zmdb/transport-redis` is the explicit Redis Pub/Sub transport for `@zmdb/app/messaging`.

It is intentionally non-durable: publishing without a connected subscriber loses the message. The strategy reports `redelivery: false`, `deadLetter: false`, and `requestResponse: true`, so application
startup requires an `onUndeliverable` sink.

## Install

```bash
npm add @zmdb/transport-redis@alpha redis
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Usage

```ts
import { transportExtension } from '@zmdb/app/messaging';
import { createRedisStrategy } from '@zmdb/transport-redis';

const redis = createRedisStrategy({
  connection: { url: process.env.REDIS_URL },
  channels: ['orders.get'],
  channelPatterns: ['orders.events.*'],
  onError: error => transportErrors.report(error),
});

const extension = transportExtension({
  transports: [redis],
  dispatcher: {
    onUnhandled: message => audit.unhandled(message),
    onInvalidPayload: (message, error) => audit.invalid(message, error),
    onHandlerError: (message, error) => audit.failed(message, error),
    onUndeliverable: (message, settlement) => audit.dropped(message, settlement),
  },
});
```

Exact channels and Redis glob subscriptions dispatch the concrete delivered channel. Requests use a generated process-owned reply-channel prefix and the correlation id supplied by the app messaging
client.

## Entry points

- `@zmdb/transport-redis` — `createRedisStrategy` and `RedisStrategyOptions`.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
