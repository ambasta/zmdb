# @zmdb/transport-rabbitmq

`@zmdb/transport-rabbitmq` adapts RabbitMQ topic exchanges to the transport-neutral messaging contract from `@zmdb/app`.

The strategy requires positive consumer prefetch, confirms request, reply, event, and delayed-retry publishes, and owns the retry and dead-letter exchanges and queues used by its settlement model.

## Install

```bash
npm add @zmdb/transport-rabbitmq@alpha amqplib@^2.0.1
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

The sole peer is `amqplib@^2.0.1`. Neither it nor this package is installed by `npm add zmdb@alpha`.

## Usage

```ts
import { createRabbitMqStrategy } from '@zmdb/transport-rabbitmq';

const connection = process.env.RABBITMQ_URL;
if (connection === undefined) throw new Error('RABBITMQ_URL is required');

const rabbitmq = createRabbitMqStrategy({
  connection,
  exchange: 'orders',
  queue: 'orders.worker',
  bindings: ['orders.*'],
  prefetch: 32,
  deadLetter: {
    exchange: 'orders.dead',
    queue: 'orders.worker.dead',
  },
  onError: error => console.error(error),
});

void rabbitmq;
```

Attach the strategy through `transportExtension` from `@zmdb/app/messaging`. The application lifecycle starts it, stops intake, drains accepted dispatches under the application grace bound, and closes
its channels and connection. The strategy owns the exchanges and queues named in its options; the application must choose names that do not collide with infrastructure managed elsewhere.

## Entry points

- `@zmdb/transport-rabbitmq` — `createRabbitMqStrategy` and its option types.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
