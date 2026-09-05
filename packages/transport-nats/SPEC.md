# `@zmdb/transport-nats` — core NATS transport strategy

> Frozen by #654 for epic #653 and implemented by #658. The strategy, matcher, executable evidence and sole public root entry belong to this package.

## 1. Boundary and exports

The package implements the public `@zmdb/app` transport SPI for core NATS. JetStream is not implied.

```ts
export interface NatsSubscription {
  readonly subject: string;
  readonly queue?: string;
}

export interface NatsStrategyOptions {
  readonly connection?: NodeConnectionOptions;
  readonly name?: string;
  readonly onError: TransportErrorSink;
  readonly subscriptions: readonly NatsSubscription[];
}

export function createNatsStrategy(options: NatsStrategyOptions): TransportStrategy;
```

The root is the only export. It depends on `@zmdb/app` at `workspace:^` and declares one required external peer, `@nats-io/transport-node@^3.4.0`; release tests use `3.4.0`.

## 2. Semantics and lifecycle

The frozen capability tuple is `{ redelivery: false, deadLetter: false, requestResponse: true }`. Native `*` and final-`>` subjects plus queue groups are supported. Subscription membership is compiled
at construction and delivery dispatches the concrete subject.

The strategy instance is caller/application owned. Its first `listen` opens one NATS connection and the declared subscriptions; another `listen` or a listen after close fails. `close(graceMs)` drains
the subscriptions, waits for accepted dispatches, flushes pending replies and closes the connection; it force-closes on timeout. Connections are never module scoped or shared implicitly.

Core NATS is at-most-once. Retry/dead outcomes are observable through the app's undeliverable sink rather than represented as broker support. Request timeout and cancellation use the common app
transport contract; no adapter-owned retry policy exists.

## 3. Migration and installation

`@zmdb/web/microservices/nats` is removed with no forwarding subpath. The package imports only public app messaging/transport-kit contracts, never web source.

```sh
yarn add @zmdb/transport-nats @nats-io/transport-node
```

## 4. Required evidence

1. Unit tests retain subject validation, trie matching, request/reply correlation, timeout, cancellation and bounded drain.
2. A required release lane supplies `ZMDB_NATS_URL` and proves wildcard queue-group event and request delivery against a real NATS server. An unavailable service fails that lane; a skipped describe is
   not release evidence.
3. A packed external app imports the root, typechecks options against the installed peer, starts it through `transportExtension` and closes cleanly.
4. Manifest and graph checks show that this package is the sole owner of the NATS peer and that core installations do not contain it.
