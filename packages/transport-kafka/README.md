# @zmdb/transport-kafka

Kafka event transport for the zmdb application messaging contract. Install with `npm install @zmdb/transport-kafka kafkajs` and supply an explicitly configured Kafka client, consumer group, input
topics and dead-letter topic. Attach the strategy with `transportExtension` from `@zmdb/app/messaging`.

See [Kafka contract](https://github.com/ambasta/zmdb/blob/main/packages/transport-kafka/SPEC.md) for options, ordered offset commits, retry scope and lifecycle. Kafka delivery attempts are local to
the current process and assignment; no durable retry counter or request/response API is provided.
