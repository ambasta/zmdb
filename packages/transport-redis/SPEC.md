# `@zmdb/transport-redis` — Redis Pub/Sub transport strategy

> Frozen by #654 for epic #653 and implemented by #660. The package now owns the Redis strategy, tests, peer, lifecycle, and installed-consumer evidence described below.

## 1. Boundary and exports

```ts
export interface RedisStrategyOptions {
  readonly channels?: readonly string[];
  readonly channelPatterns?: readonly string[];
  readonly connection?: RedisClientOptions;
  readonly name?: string;
  readonly onError: (error: unknown) => void;
  readonly replyPrefix?: string;
}

export function createRedisStrategy(options: RedisStrategyOptions): TransportStrategy;
```

The root is the only export. It depends on `@zmdb/app` at `workspace:^` and declares one required external peer, `redis@^6.2.1`; release tests use `6.2.1`.

## 2. Semantics and lifecycle

The capability tuple is `{ redelivery: false, deadLetter: false, requestResponse: true }`. Exact channels and Redis glob subscriptions dispatch concrete channel names. Publishing without a connected
subscriber is lossy and the app therefore requires an undeliverable sink.

The caller/application owns the strategy. The first `listen` creates one publisher and one duplicated subscriber from the supplied connection options, subscribes the reply prefix and configured
channels, and rejects duplicate starts. `close(graceMs)` unsubscribes, rejects pending replies, drains accepted dispatches, closes both clients and destroys them on timeout. No client, reply registry
or generated prefix is shared across strategy instances.

## 3. Migration and installation

`@zmdb/web/microservices/redis` is removed with no forwarding subpath. The package imports only public app messaging/transport-kit contracts.

```sh
yarn add @zmdb/transport-redis redis
```

## 4. Required evidence

1. Unit tests retain channel validation, concrete-pattern dispatch, request/reply correlation, malformed reply handling, timeout, cancellation and bounded drain.
2. A required release lane supplies `ZMDB_REDIS_URL` and proves both loss with no subscriber and delivery to a live subscriber against a real Redis server. Missing service access fails qualification.
3. A packed external app imports the root, starts it through `transportExtension`, performs event and request/reply calls and closes both clients.
4. Manifest and graph checks prove that this package alone declares the Redis peer and that core installations do not contain it.
