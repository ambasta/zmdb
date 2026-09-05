import { encodeDelivery, encodeReply, MessageTimeoutError } from '@zmdb/app/messaging';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const brokerFactory = vi.hoisted(() => ({
  connect: (_options?: unknown): Promise<unknown> => {
    throw new Error('NATS test factory is not configured');
  },
  inbox: 0,
}));

vi.mock('@nats-io/transport-node', () => ({
  connect: (options?: unknown): Promise<unknown> => brokerFactory.connect(options),
  createInbox: (): string => {
    brokerFactory.inbox += 1;
    return `_INBOX.test.${String(brokerFactory.inbox)}`;
  },
}));

import { createNatsStrategy } from './index.js';
import { createNatsSubjectMatcher } from './matcher.js';

interface FakeNatsMessage {
  readonly subject: string;
  readonly reply?: string;
  readonly responded: string[];
  respond(data: Uint8Array): boolean;
  string(): string;
}

type NatsCallback = (error: Error | null, message: FakeNatsMessage) => void;

class FakeNatsSubscription {
  readonly subject: string;
  readonly queue: string | undefined;
  readonly callback: NatsCallback | undefined;
  closed = false;
  drainResult: Promise<void> = Promise.resolve();

  constructor(
    subject: string,
    options: { readonly queue?: string; readonly callback?: NatsCallback; readonly max?: number } = {},
  ) {
    this.subject = subject;
    this.queue = options.queue;
    this.callback = options.callback;
  }

  unsubscribe(): void {
    this.closed = true;
  }

  async drain(): Promise<void> {
    this.closed = true;
    await this.drainResult;
  }

  deliver(subject: string, payload: string, reply?: string): FakeNatsMessage {
    const message: FakeNatsMessage = {
      subject,
      ...(reply === undefined ? {} : { reply }),
      responded: [],
      respond(data): boolean {
        message.responded.push(new TextDecoder().decode(data));
        return reply !== undefined;
      },
      string: () => payload,
    };
    this.callback?.(null, message);
    return message;
  }
}

class FakeNatsConnection {
  readonly subscriptions: FakeNatsSubscription[] = [];
  readonly published: {
    readonly subject: string;
    readonly data: Uint8Array;
    readonly reply?: string;
  }[] = [];
  closeCalls = 0;
  flushCalls = 0;

  subscribe(
    subject: string,
    options: { readonly queue?: string; readonly callback?: NatsCallback; readonly max?: number } = {},
  ): FakeNatsSubscription {
    const opened = new FakeNatsSubscription(subject, options);
    this.subscriptions.push(opened);
    return opened;
  }

  publish(subject: string, data: Uint8Array, options: { readonly reply?: string } = {}): void {
    this.published.push({
      subject,
      data,
      ...(options.reply === undefined ? {} : { reply: options.reply }),
    });
  }

  flush(): Promise<void> {
    this.flushCalls += 1;
    return Promise.resolve();
  }

  closed(): Promise<void | Error> {
    return new Promise(() => undefined);
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

function subscription(connection: FakeNatsConnection, subject: string): FakeNatsSubscription {
  const found = connection.subscriptions.find(candidate => candidate.subject === subject);
  if (found === undefined) {
    throw new Error(`test expected subscription ${subject}`);
  }
  return found;
}

function configure(connection: FakeNatsConnection): void {
  brokerFactory.connect = () => Promise.resolve(connection);
}

beforeEach(() => {
  brokerFactory.inbox = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('@zmdb/transport-nats', () => {
  it('matches NATS wildcards through a startup trie with native token semantics', () => {
    const patterns = ['orders.*.created', 'audit.>'];
    const matcher = createNatsSubjectMatcher(patterns);
    patterns.splice(0, patterns.length, 'mutated.>');

    expect({
      oneToken: matcher.matches('orders.eu.created'),
      noToken: matcher.matches('orders.created'),
      tooMany: matcher.matches('orders.eu.priority.created'),
      tail: matcher.matches('audit.eu.security'),
      emptyTail: matcher.matches('audit'),
      laterMutation: matcher.matches('mutated.subject'),
    }).toEqual({
      oneToken: true,
      noToken: false,
      tooMany: false,
      tail: true,
      emptyTail: false,
      laterMutation: false,
    });
  });

  it('validates subjects, wildcard tokens, queue groups, and duplicate subscriptions before connecting', () => {
    const onError = (): void => undefined;

    expect(() => createNatsStrategy({ subscriptions: [{ subject: '' }], onError })).toThrow(
      '@zmdb/transport-nats: a NATS subscription subject cannot be empty',
    );
    expect(() => createNatsStrategy({ subscriptions: [{ subject: 'orders.*', queue: '' }], onError })).toThrow(
      '@zmdb/transport-nats: a NATS queue group cannot be empty',
    );
    expect(() =>
      createNatsStrategy({
        subscriptions: [
          { subject: 'orders.*', queue: 'workers' },
          { subject: 'orders.*', queue: 'workers' },
        ],
        onError,
      }),
    ).toThrow('@zmdb/transport-nats: duplicate NATS subscription "orders.*"');
    expect(() => createNatsStrategy({ subscriptions: [{ subject: 'orders.>.created' }], onError })).toThrow(
      '@zmdb/transport-nats: a NATS > wildcard must be the final token',
    );
  });

  it('passes queue groups to NATS and dispatches the concrete subject behind a wildcard', async () => {
    const connection = new FakeNatsConnection();
    configure(connection);
    const patterns: string[] = [];
    const strategy = createNatsStrategy({
      subscriptions: [{ subject: 'orders.*', queue: 'orders-workers' }],
      onError: error => {
        throw error;
      },
    });
    await strategy.listen(message => {
      patterns.push(message.pattern);
      return Promise.resolve({ settlement: { kind: 'ack' } });
    });

    subscription(connection, 'orders.*').deliver('orders.created', encodeDelivery({ id: 1 }, undefined));
    await vi.waitFor(() => expect(patterns).toEqual(['orders.created']));
    expect(connection.subscriptions.map(opened => [opened.subject, opened.queue])).toEqual([
      ['orders.*', 'orders-workers'],
    ]);
    expect(strategy.capabilities).toEqual({
      redelivery: false,
      deadLetter: false,
      requestResponse: true,
    });
    await strategy.close(100);
  });

  it('correlates a request reply through a one-shot NATS inbox', async () => {
    const connection = new FakeNatsConnection();
    configure(connection);
    const strategy = createNatsStrategy({
      subscriptions: [],
      onError: error => {
        throw error;
      },
    });
    await strategy.listen(() => Promise.resolve({ settlement: { kind: 'ack' } }));

    const controller = new AbortController();
    const pending = strategy.send({
      pattern: 'orders.get',
      payload: { id: 7 },
      correlationId: 'request-7',
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(connection.published).toHaveLength(1));
    expect(connection.published[0]).toMatchObject({
      subject: 'orders.get',
      reply: '_INBOX.test.1',
    });
    const inbox = subscription(connection, '_INBOX.test.1');
    inbox.deliver('_INBOX.test.1', encodeReply({ kind: 'result', correlationId: 'request-7', payload: { id: 7 } }));

    await expect(pending).resolves.toEqual({
      kind: 'result',
      correlationId: 'request-7',
      payload: { id: 7 },
    });
    expect(inbox.closed).toBe(true);
    await strategy.close(100);
  });

  it('removes the inbox subscription when a request times out', async () => {
    vi.useFakeTimers();
    const connection = new FakeNatsConnection();
    configure(connection);
    const strategy = createNatsStrategy({
      subscriptions: [],
      onError: error => {
        throw error;
      },
    });
    await strategy.listen(() => Promise.resolve({ settlement: { kind: 'ack' } }));

    const pending = strategy.send({
      pattern: 'orders.slow',
      payload: { id: 8 },
      correlationId: 'request-8',
      timeoutMs: 25,
      signal: new AbortController().signal,
    });
    const inbox = subscription(connection, '_INBOX.test.1');
    const rejected = expect(pending).rejects.toEqual(new MessageTimeoutError('orders.slow', 25, 'request-8'));
    await vi.advanceTimersByTimeAsync(25);

    await rejected;
    expect(inbox.closed).toBe(true);
    await strategy.close(100);
  });

  it('removes the inbox subscription and preserves the abort reason on cancellation', async () => {
    const connection = new FakeNatsConnection();
    configure(connection);
    const strategy = createNatsStrategy({
      subscriptions: [],
      onError: error => {
        throw error;
      },
    });
    await strategy.listen(() => Promise.resolve({ settlement: { kind: 'ack' } }));

    const controller = new AbortController();
    const reason = new Error('caller cancelled');
    const pending = strategy.send({
      pattern: 'orders.cancel',
      payload: { id: 9 },
      correlationId: 'request-9',
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    const inbox = subscription(connection, '_INBOX.test.1');
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(inbox.closed).toBe(true);
    await strategy.close(100);
  });

  it('stops subscriptions, drains accepted dispatch, then flushes and closes the connection', async () => {
    const connection = new FakeNatsConnection();
    configure(connection);
    let release = (): void => undefined;
    let accepted = false;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const strategy = createNatsStrategy({
      subscriptions: [{ subject: 'orders.*' }],
      onError: error => {
        throw error;
      },
    });
    await strategy.listen(async () => {
      accepted = true;
      await held;
      return { settlement: { kind: 'ack' } };
    });

    const opened = subscription(connection, 'orders.*');
    opened.deliver('orders.created', encodeDelivery({ id: 10 }, undefined));
    await vi.waitFor(() => expect(accepted).toBe(true));
    const closing = strategy.close(1_000);
    await vi.waitFor(() => expect(opened.closed).toBe(true));
    expect(connection.flushCalls).toBe(1);
    expect(connection.closeCalls).toBe(0);
    release();
    await closing;
    expect(connection.flushCalls).toBe(2);
    expect(connection.closeCalls).toBe(1);
  });

  it('force-closes and rejects when bounded drain expires', async () => {
    vi.useFakeTimers();
    const connection = new FakeNatsConnection();
    configure(connection);
    const strategy = createNatsStrategy({
      subscriptions: [{ subject: 'orders.*' }],
      onError: error => {
        throw error;
      },
    });
    await strategy.listen(() => Promise.resolve({ settlement: { kind: 'ack' } }));
    subscription(connection, 'orders.*').drainResult = new Promise(() => undefined);

    const closing = strategy.close(10);
    const rejected = expect(closing).rejects.toThrow('@zmdb/transport-nats: NATS strategy did not drain within 10ms');
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(connection.closeCalls).toBe(1);
  });
});
