import { SQSClient } from '@aws-sdk/client-sqs';
import type { TransportErrorSink, TransportStrategy } from '@zmdb/app/messaging';

import { createSqsStrategy } from './index.js';
import type { SqsStrategyOptions } from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;
type ExpectedOptions = {
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
};
export type _Options = Expect<Equal<SqsStrategyOptions, ExpectedOptions>>;
export type _FactoryParameter = Expect<Equal<Parameters<typeof createSqsStrategy>, [SqsStrategyOptions]>>;
export type _FactoryReturn = Expect<Equal<ReturnType<typeof createSqsStrategy>, TransportStrategy>>;
const client = new SQSClient({ region: 'us-east-1' });
const options: SqsStrategyOptions = {
  client,
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/source',
  deadLetterQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/dead',
  waitTimeSeconds: 1,
  visibilityTimeoutSeconds: 30,
  maxInFlight: 5,
  requestTimeoutMs: 2000,
  pollRetryMs: 50,
  onError: (_error: unknown) => undefined,
};
const strategy: TransportStrategy = createSqsStrategy(options);
void strategy;
// @ts-expect-error The selected SDK client is caller-owned and required.
createSqsStrategy({ ...options, client: undefined });
// @ts-expect-error Queue URLs are required, never globally discovered.
createSqsStrategy({ client, onError: (_error: unknown) => undefined });
// @ts-expect-error Error observation is required.
createSqsStrategy({ ...options, onError: undefined });
// @ts-expect-error FIFO delivery is not part of the standard queue contract.
createSqsStrategy({ ...options, fifo: true });
// @ts-expect-error String concurrency is not accepted.
createSqsStrategy({ ...options, maxInFlight: '5' });
// @ts-expect-error The removed web messaging owner is not a compatibility path.
import type { TransportStrategy as OldStrategy } from '@zmdb/web/microservices';
export type _OldStrategyRefusal = OldStrategy;
