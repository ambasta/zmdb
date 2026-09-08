# Kafka event transport

## 1. Public entry

`@zmdb/transport-kafka` exports `createKafkaStrategy(options: KafkaStrategyOptions): TransportStrategy` and the options type. It uses KafkaJS `>=2.2.4 <3.0.0` and the public `@zmdb/app/messaging`
contract. There is one implementation and one package entry.

Options require a caller-configured `client: Kafka`, `groupId: string`, nonempty unique `topics: readonly string[]`, `deadLetterTopic: string`, positive integer
`partitionsConsumedConcurrently: number`, and `onError: TransportErrorSink`. Optional `name` defaults to `kafka`, `fromBeginning` to `false`, `sessionTimeoutMs` to 30000, `heartbeatIntervalMs` to
3000, and `errorRetryMs` to 1000. Timing values are positive integers at most 2147483647; heartbeat is smaller than session timeout. Topic names follow Kafka's nonempty 249-character ASCII
letter/digit/dot/underscore/hyphen rule and cannot be `.` or `..`. The dead-letter topic cannot be an input topic. Empty groups, duplicate topics and invalid bounds fail before creating resources. The
input options and topic list are snapshotted at construction.

The Kafka factory remains caller-owned. The strategy creates and exclusively owns its producer and consumer when listening. It does not create topics or destroy a caller's independent producer,
consumer or administrator. Producer acknowledgements require all in-sync replicas (`acks: -1`); automatic topic creation is disabled.

## 2. Delivery and offsets

The capabilities are `{ redelivery: true, deadLetter: true, requestResponse: false }`. `send` always rejects without broker activity. `listen` may run once, opens the owned producer/consumer,
subscribes to the explicit topics and uses ordered batches with both auto commit and automatic batch resolution disabled. It uses the configured partition concurrency. An emit requires a listening,
open strategy, publishes `encodeDelivery(payload, carrier)` to the pattern topic and resolves only after the SDK acknowledgement. An undefined/unserializable payload or invalid topic is rejected.

Each message becomes `decodeDelivery(topic, value, deliveryAttempt)` and reaches the supplied app dispatcher. Null or malformed values reach the dispatcher as parse errors. Within each partition only
one message is dispatched at a time. The next offset is the current decimal offset plus one using integer arithmetic without Number precision loss. An acknowledgement is committed before the next
message can dispatch. A dead settlement sends the original value/key to the configured dead-letter topic with string headers `zmdb-source-topic`, `zmdb-source-partition`, `zmdb-source-offset`,
`zmdb-delivery-attempt` and `zmdb-dead-reason`; the send must be acknowledged before committing. Existing record headers are preserved except these authoritative metadata keys.

A retry commits nothing for that record or later records, seeks to the current offset, pauses only that topic/partition, and resumes it after `afterMs`. Retry delays are finite integers from zero
through 2147483647. Other assigned partitions may progress. Delivery attempts count dispatches of an unsettled offset in the current process and assignment; they restart at one after process restart
or reassignment. Kafka does not supply a durable attempt counter, and this package does not invent one. The app may enforce an attempt limit within that scope. There is no exactly-once or
cross-restart retry-limit guarantee.

Failed dispatch, heartbeat, acknowledgement, dead-letter publication or offset commit reaches `onError` and leaves the current record unsettled. It retries that partition after `errorRetryMs`. A
throwing error sink cannot replace settlement or lifecycle behavior. SDK crash errors also reach the sink. Rebalance invalidates in-flight ownership and retry timers; stale/non-running batches and
stale handler completions cannot commit, send a dead letter or dispatch a following record. Broker commit errors are propagated to the sink, never treated as success. Heartbeats continue while an
accepted handler is pending.

## 3. Lifecycle

Duplicate listen, use after close and emission before listen reject. Startup failure disconnects both created resources, preserves the original failure and permits no later dispatch. Close during
startup also prevents later intake or publication. `close(graceMs)` requires a finite nonnegative integer bound, is idempotent, prevents new work, clears retry timers and stops consumer intake. An
in-flight handler may settle during the grace period. Successful close awaits disconnection. After the grace expires, late results cannot settle, forced disconnection is initiated and close rejects
with a drain-timeout error. An SDK disconnect still pending at that deadline is observed without extending the deadline; a later failure reaches `onError`. A nonsettling handler is caller work and is
not claimed cancelled. Pending broker sends and startup are fenced by the same close state. No retry resumes after close.

## 4. Qualification

Unit tests exercise actual strategy calls against controlled SDK doubles, including settlement ordering, retry, stale ownership, failure and close. A real Kafka broker and real KafkaJS producer,
consumer and independent administrator prove records, committed group offsets, restart replay, partition ordering and dead-letter records over TCP. A packed external consumer uses actual npm
installation, lock-backed npm ci, strict installed declarations and public app dispatch. Broker resources use unique task-owned names and are cleaned. Missing live configuration fails the explicit
integration command; it cannot silently count as a pass. Local broker qualification makes no hosted-service or performance claim.
