# `@zmdb/transport-sqs`

This package implements the `@zmdb/app/messaging` event transport for explicitly selected SQS standard queues. Local acceptance uses AWS SDK `3.1127.0`, ElasticMQ and WireMock; it makes no
AWS-service, FIFO or exactly-once claim.

## 1. Public contract

The root exports one value, `createSqsStrategy`, and the `SqsStrategyOptions` type. There are no subpaths or web forwarding entries.

```ts
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { TransportErrorSink, TransportStrategy } from '@zmdb/app/messaging';

export interface SqsStrategyOptions {
  readonly client: SQSClient;
  readonly queueUrl: string;
  readonly deadLetterQueueUrl: string;
  readonly waitTimeSeconds: number;
  readonly visibilityTimeoutSeconds: number;
  readonly maxInFlight: number;
  readonly requestTimeoutMs: number;
  readonly pollRetryMs: number;
  readonly onError: TransportErrorSink;
  readonly name?: string;
}

export function createSqsStrategy(options: SqsStrategyOptions): TransportStrategy;
```

The caller creates, configures and destroys the SDK client and both queues. The adapter never creates or destroys them. Queue URLs must be distinct HTTP(S) standard-queue URLs; `.fifo` is rejected.
Construction validates all required values before SDK work. `waitTimeSeconds` is an integer from 1 through 20; visibility is an integer from 1 through 43,200 seconds; `maxInFlight` is a positive safe
integer. Request timeout is a finite positive integer greater than the long-poll duration and at most 2,147,483,647 milliseconds. Poll-error retry delay is an integer from 1 through 60,000
milliseconds. `onError` is required. The default name is `sqs`; a supplied name must be nonempty.

## 2. Methods and ownership

- `listen(dispatch)` checks both explicit queues with `GetQueueAttributes(FifoQueue)` and starts bounded intake. A FIFO queue or SDK startup failure rejects startup. Duplicate start and start after
  close are rejected.
- At most one `ReceiveMessage` request is outstanding. Its batch limit is `min(10, remaining in-flight capacity)`; the configured wait and visibility are sent explicitly. It requests
  `ApproximateReceiveCount` and all message attributes. Intake pauses when accepted work fills the limit. Poll failures reach `onError` and wait `pollRetryMs` before another receive.
- `emit(pattern, payload, carrier?)` requires a listening strategy and a nonempty pattern. It awaits the caller client's actual `SendMessage`. Encoding and SDK errors reject the caller's operation.
  Undefined payloads are refused by the app's canonical encoder.
- `send(request)` always rejects the app's `TransportUnsupportedError` before any SDK operation. Capabilities are `{ redelivery: true, deadLetter: true, requestResponse: false }`.
- `close(graceMs)` takes a finite nonnegative integer bound at most 2,147,483,647 milliseconds. It stops intake, aborts a pending receive, and drains accepted work and its settlement. Expiry aborts
  remaining SDK requests, prevents late settlement and rejects with a drain error. Repeated close is safe. No client `destroy()` call is made. A fresh strategy can reuse the caller client after an
  earlier strategy closes.

## 3. Exact wire contract

`MessageBody` is the version-1 JSON text produced by `encodeDelivery` from the public app transport kit. The concrete event pattern is the `zmdb-pattern` message attribute with `DataType: String`;
trace fields remain in the canonical body. There is no second JSON wrapper or historical reader.

Incoming bodies pass through `decodeDelivery`. `ApproximateReceiveCount` supplies `deliveryAttempt`, defaulting to 1 when absent. Invalid body or pattern framing reaches the dispatcher as
`RawMessage.parseError`; malformed input remains inspectable. A missing receipt is reported without dispatch because it cannot be settled safely.

| Dispatcher outcome            | SDK operation                                                                                                 | Source deletion                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `ack`                         | `DeleteMessage` with the current receipt                                                                      | after dispatch completes                          |
| `retry`                       | `ChangeMessageVisibility` with the current receipt and `ceil(afterMs / 1000)`                                 | none                                              |
| `dead`                        | `SendMessage` to the explicit DLQ, preserving body bytes and attributes and adding `zmdb-dead-reason: String` | only after destination send resolves successfully |
| dispatch or settlement throws | report the original failure                                                                                   | no fabricated successful settlement               |

Retry delays must be finite and positive and round to at most 43,200 seconds. An invalid delay is reported without settlement. Receipt handles belong to individual deliveries; a repeated message ID
never permits reuse of an earlier receipt. Failed DLQ sends never delete the source. Error-sink failures cannot replace transport outcomes.

The configured visibility can expire before a long-running handler finishes. Standard-queue redelivery remains possible, including duplicates after an uncertain send/delete response. Applications
choose an appropriate visibility and idempotent handlers; this adapter does not invent an exactly-once lease or visibility-extension protocol.

## 4. Acceptance

`src/index.spec.ts` freezes options, methods, SDK commands, settlement ordering, error propagation, in-flight bounds, cancellation and caller ownership. `src/index.type-test.ts` freezes the complete
option shape, factory signature and invalid calls. `src/__integration__/sqs.spec.ts` runs actual SDK delivery, visibility redelivery, dead letters, restart and HTTP failure/cancellation observations
with isolated local fixtures.

`fixtures/consumer-transport-sqs/verify-installed.mjs` performs real build, `npm pack`, registry-backed `npm install` and lock-backed `npm ci`. Its only explicit product roots are this transport and
`@zmdb/app`, alongside the selected AWS SDK and typecheck tools. Strict installed declarations, private-export refusals and an actual application extension are required. Owned queues, containers,
registry, child processes and temporary directories are cleaned; missing local fixtures fail without skips. No paid cloud resource is a prerequisite.
