# @zmdb/transport

`@zmdb/transport` holds one transport adapter per subpath for the protocol-neutral messaging contract owned by `@zmdb/app`. gRPC, Kafka, NATS, RabbitMQ, Redis and SQS each keep their own connection
lifetime, acknowledgement policy and executable evidence. The package adds no broker of its own, no shared abstraction over the six, and no code that runs on import.

## Install

```bash
yarn add @zmdb/transport@1.0.0-beta.2 @zmdb/app@1.0.0-beta.2 kafkajs
```

> **Prerelease** (`1.0.0-beta.2`). Requires **Node.js 26+** and is **ESM-only**. `@zmdb/app` is a required peer. Every client library is an **optional** peer: install only the one your transport
> needs.

## Entry points

- `@zmdb/transport/grpc` — gRPC server extension and typed clients over generated `@zmdb/protobuf` service artifacts. Peer: `@grpc/grpc-js`.
- `@zmdb/transport/kafka` — Kafka event transport with ordered manual offsets and partition retries. Peer: `kafkajs`.
- `@zmdb/transport/nats` — core NATS request/reply and event strategy. Peer: `@nats-io/transport-node`.
- `@zmdb/transport/rabbitmq` — RabbitMQ strategy with confirmed retries and an owned dead-letter topology. Peer: `amqplib`.
- `@zmdb/transport/redis` — Redis Pub/Sub strategy. Peer: `redis`.
- `@zmdb/transport/sqs` — SQS standard-queue events with explicit receipts and confirmed dead-letter handoff. Peer: `@aws-sdk/client-sqs`.

There is no root export. Importing `@zmdb/transport` alone resolves to nothing, so selecting one transport never pulls the other five into a graph.

## Selecting a transport

```ts
import { createApplication } from '@zmdb/app';
import { createKafkaStrategy } from '@zmdb/transport/kafka';

const app = await createApplication(AppModule, {
  transport: createKafkaStrategy({ brokers: ['localhost:9092'], groupId: 'orders' }),
});
```

gRPC is an application extension rather than a messaging strategy, because it is not a broker:

```ts
import { grpcExtension } from '@zmdb/transport/grpc';

const app = await createApplication(AppModule, { extensions: [grpcExtension(serverOptions)] });
```

## Documentation

Broker transports are documented at **https://ambasta.github.io/zmdb/docs/web-microservices-transports.html** and gRPC at **https://ambasta.github.io/zmdb/docs/web-microservices-grpc.html**.

## License

Mozilla Public License 2.0 (MPL-2.0).
