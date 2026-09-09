# `@zmdb/transport-sqs`

SQS standard-queue events for `@zmdb/app/messaging`.

```sh
yarn add @zmdb/transport-sqs@1.0.0-beta.2 @zmdb/app@1.0.0-beta.2 @aws-sdk/client-sqs@3.1127.0
```

```ts
import { SQSClient } from '@aws-sdk/client-sqs';
import { createSqsStrategy } from '@zmdb/transport-sqs';

const client = new SQSClient({ region: 'us-east-1' });
const transport = createSqsStrategy({
  client,
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/orders',
  deadLetterQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/orders-dead',
  waitTimeSeconds: 10,
  visibilityTimeoutSeconds: 60,
  maxInFlight: 16,
  requestTimeoutMs: 15_000,
  pollRetryMs: 1000,
  onError: error => console.error(error),
});
```

Attach the transport with the app's `transportExtension`. The caller owns the SDK client and both queues. Successful dispatch deletes its current receipt; retry changes visibility; a dead letter is
sent to the explicit destination before the source receipt is deleted. `close(graceMs)` stops intake and drains accepted work within the supplied bound. Destroy the caller client after application
shutdown.

The package supports events on standard queues. Request/response and FIFO are refused. Standard queues may redeliver; choose suitable visibility and idempotent handlers. Local qualification uses the
real AWS SDK with isolated ElasticMQ and WireMock fixtures, not an AWS account.

The complete methods, options and wire contract are in [SPEC.md](./SPEC.md).
