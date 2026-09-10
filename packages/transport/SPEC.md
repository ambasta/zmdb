# `@zmdb/transport` — transport adapters for the application messaging contract

> Boundary spec for the package that replaces the six `@zmdb/transport-*` packages. Each subpath keeps the contract it was frozen with; the per-transport detail lives in `src/<transport>/SPEC.md` and
> stays normative.

## 1. Package boundary

The package holds one adapter per transport behind one npm name. Every adapter targets the public `@zmdb/app/messaging` contract, or in gRPC's case the `@zmdb/app` extension lifecycle, and none of
them is reachable from core. Nothing is shared between subpaths: they exist together because they are installed the same way and versioned the same way, not because they share code.

| Subpath                    | Detail spec                                      | Third-party peer          | Range               |
| -------------------------- | ------------------------------------------------ | ------------------------- | ------------------- |
| `@zmdb/transport/grpc`     | [`src/grpc/SPEC.md`](./src/grpc/SPEC.md)         | `@grpc/grpc-js`           | `^1.14.4`           |
| `@zmdb/transport/kafka`    | [`src/kafka/SPEC.md`](./src/kafka/SPEC.md)       | `kafkajs`                 | `>=2.2.4 <3.0.0`    |
| `@zmdb/transport/nats`     | [`src/nats/SPEC.md`](./src/nats/SPEC.md)         | `@nats-io/transport-node` | `^3.4.0`            |
| `@zmdb/transport/rabbitmq` | [`src/rabbitmq/SPEC.md`](./src/rabbitmq/SPEC.md) | `amqplib`                 | `^2.0.1`            |
| `@zmdb/transport/redis`    | [`src/redis/SPEC.md`](./src/redis/SPEC.md)       | `redis`                   | `^6.2.1`            |
| `@zmdb/transport/sqs`      | [`src/sqs/SPEC.md`](./src/sqs/SPEC.md)           | `@aws-sdk/client-sqs`     | `>=3.1127.0 <4.0.0` |

Manifest edges are exact:

| Kind          | Package          | Range            |
| ------------- | ---------------- | ---------------- |
| dependency    | `@zmdb/protobuf` | `workspace:^`    |
| required peer | `@zmdb/app`      | `1.0.0-beta.2`   |
| optional peer | the six above    | the ranges above |

Every third-party peer is optional, because installing the package must not oblige a caller to install six client libraries to use one transport. A subpath imported without its peer present fails at
resolution with the peer's own error; no adapter probes for an absent peer or degrades silently. `@zmdb/protobuf` is a real dependency rather than a peer because only the gRPC subpath reaches it and
generated service artifacts must resolve to one copy.

There is no root export. `@zmdb/transport` on its own resolves to nothing, so no import can pull six adapters into a bundle by accident, and no subpath re-exports another.

## 2. Ownership

- `@zmdb/protobuf` owns generated service artifacts and the `GrpcLoaded*`/`Grpc*Def` types. The gRPC subpath adapts them and re-exports none of them.
- `@zmdb/app/messaging` owns the transport-neutral broker contract: patterns, envelopes, acknowledgement and retry semantics. [`../app/src/messaging/SPEC.md`](../app/src/messaging/SPEC.md) remains its
  spec.
- Each subpath owns its wire protocol, its connection lifetime and its own executable evidence.
- Core `@zmdb/app`, `@zmdb/web`, `@zmdb/jobs` and `@zmdb/core` neither import nor re-export any subpath.
- TLS material, metadata validators, credentials and error sinks are caller supplied. No subpath discovers credentials, installs global interceptors or retries beyond the policy its detail spec
  states.

## 3. Installation

Install the package and only the peers for the transports in use:

```sh
yarn add @zmdb/transport @grpc/grpc-js
yarn add @zmdb/transport kafkajs
```

## 4. Required evidence

1. Each subpath keeps the acceptance evidence its detail spec requires, unchanged by the move: real in-process gRPC calls, and live-service suites for Kafka, NATS, RabbitMQ, Redis and SQS.
2. A package-boundary type suite per subpath proves its handler, stream-shape and options contracts against packed declarations.
3. A packed external application installs `@zmdb/transport` plus one peer, starts the transport it selected, exchanges a message and shuts down. Installing one peer is enough: the other five stay
   absent.
4. Importing a subpath opens no connection, binds no socket and loads no proto parser.
5. Static dependency checks prove that each third-party client library is declared by this package alone and that neither core nor `@zmdb/protobuf` reaches it.
