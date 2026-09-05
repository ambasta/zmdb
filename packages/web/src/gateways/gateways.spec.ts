// Tests (#309) for WS/SSE gateways — RED first (gateways exports absent).
// Subscription metadata, dispatch with typed message ctx, SSE framing.
// Per packages/web/src/gateways/SPEC.md.
import { describe, it, expect } from 'vitest';

import {
  Gateway,
  Subscribe,
  getSubscriptions,
  createGatewayDispatcher,
  sseStream,
  type MessageCtx,
  type SseFrame,
} from './index.js';

@Gateway('chat')
class ChatGateway {
  @Subscribe('message')
  onMessage(ctx: MessageCtx<{ text: string }>) {
    return { echo: ctx.data.text };
  }

  @Subscribe('join')
  onJoin(ctx: MessageCtx<{ room: string }>) {
    return { joined: ctx.data.room };
  }
}

describe('@zmdb/web gateways: subscriptions', () => {
  it('records @Subscribe handlers', () => {
    const subs = getSubscriptions(ChatGateway);
    expect(subs).toEqual([
      { event: 'message', handlerName: 'onMessage' },
      { event: 'join', handlerName: 'onJoin' },
    ]);
  });
});

describe('@zmdb/web gateways: dispatch', () => {
  it('routes an event to its handler with a typed message ctx', async () => {
    const dispatcher = createGatewayDispatcher(new ChatGateway());
    expect(await dispatcher.dispatch('message', { text: 'hi' })).toEqual({ echo: 'hi' });
    expect(await dispatcher.dispatch('join', { room: 'general' })).toEqual({ joined: 'general' });
  });

  it('returns undefined for an unknown event', async () => {
    const dispatcher = createGatewayDispatcher(new ChatGateway());
    expect(await dispatcher.dispatch('nope', {})).toBeUndefined();
  });
});

describe('@zmdb/web gateways: SSE', () => {
  it('frames an async iterable as SSE', async () => {
    async function* source() {
      yield { event: 'tick', data: { n: 1 } };
      yield { data: { n: 2 } };
    }
    const stream = sseStream(source());
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out += decoder.decode(value);
    }
    expect(out).toContain('event: tick\ndata: {"n":1}\n\n');
    expect(out).toContain('data: {"n":2}\n\n');
  });

  it('awaits source cleanup when the reader cancels', async () => {
    const cleanupStarted = Promise.withResolvers<void>();
    const releaseCleanup = Promise.withResolvers<void>();
    let finalized = false;
    async function* source() {
      try {
        yield { event: 'tick', data: { n: 1 } };
      } finally {
        cleanupStarted.resolve();
        await releaseCleanup.promise;
        finalized = true;
      }
    }

    const reader = sseStream(source()).getReader();
    expect(await reader.read()).toMatchObject({ done: false });

    let cancellationSettled = false;
    const cancellation = reader.cancel('client disconnected').then(() => {
      cancellationSettled = true;
    });
    await cleanupStarted.promise;
    await Promise.resolve();
    expect(cancellationSettled).toBe(false);

    releaseCleanup.resolve();
    await expect(cancellation).resolves.toBeUndefined();
    expect(finalized).toBe(true);
  });

  it('resolves cancellation when the source iterator has no return method', async () => {
    const pending = Promise.withResolvers<IteratorResult<SseFrame>>();
    let reads = 0;
    const source: AsyncIterable<SseFrame> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            reads++;
            if (reads === 1) {
              return Promise.resolve({ done: false, value: { data: { n: 1 } } });
            }
            return pending.promise;
          },
        };
      },
    };

    const reader = sseStream(source).getReader();
    expect(await reader.read()).toMatchObject({ done: false });
    await expect(reader.cancel('client disconnected')).resolves.toBeUndefined();
    pending.resolve({ done: true, value: undefined });
  });

  it('awaits rejecting source cleanup but resolves the disconnect', async () => {
    const pending = Promise.withResolvers<IteratorResult<SseFrame>>();
    const cleanupStarted = Promise.withResolvers<void>();
    const releaseCleanup = Promise.withResolvers<void>();
    let reads = 0;
    let returns = 0;
    const source: AsyncIterable<SseFrame> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            reads++;
            if (reads === 1) {
              return Promise.resolve({ done: false, value: { data: { n: 1 } } });
            }
            return pending.promise;
          },
          async return() {
            returns++;
            cleanupStarted.resolve();
            await releaseCleanup.promise;
            throw new Error('cleanup failed');
          },
        };
      },
    };

    const reader = sseStream(source).getReader();
    expect(await reader.read()).toMatchObject({ done: false });

    let cancellationSettled = false;
    const cancellation = reader.cancel('client disconnected').then(() => {
      cancellationSettled = true;
    });
    await cleanupStarted.promise;
    await Promise.resolve();
    expect(cancellationSettled).toBe(false);

    releaseCleanup.resolve();
    await expect(cancellation).resolves.toBeUndefined();
    expect(returns).toBe(1);
    pending.resolve({ done: true, value: undefined });
  });

  it('does not duplicate cleanup across an in-flight pull or natural completion', async () => {
    const pending = Promise.withResolvers<IteratorResult<SseFrame>>();
    const pullStarted = Promise.withResolvers<void>();
    let reads = 0;
    let returns = 0;
    let returnReason: unknown;
    const interrupted: AsyncIterable<SseFrame> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            reads++;
            if (reads === 1) {
              return Promise.resolve({ done: false, value: { data: { n: 1 } } });
            }
            pullStarted.resolve();
            return pending.promise;
          },
          return(reason) {
            returns++;
            returnReason = reason;
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };

    const interruptedReader = sseStream(interrupted).getReader();
    expect(await interruptedReader.read()).toMatchObject({ done: false });
    await pullStarted.promise;
    await expect(interruptedReader.cancel('client disconnected')).resolves.toBeUndefined();
    pending.resolve({ done: true, value: undefined });
    await Promise.resolve();
    expect(returns).toBe(1);
    expect(returnReason).toBe('client disconnected');

    let naturalReads = 0;
    let naturalReturns = 0;
    const completed: AsyncIterable<SseFrame> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            naturalReads++;
            return Promise.resolve(
              naturalReads === 1 ? { done: false, value: { data: { n: 1 } } } : { done: true, value: undefined },
            );
          },
          return() {
            naturalReturns++;
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };

    const completedReader = sseStream(completed).getReader();
    expect(await completedReader.read()).toMatchObject({ done: false });
    await expect(completedReader.read()).resolves.toEqual({ done: true, value: undefined });
    await expect(completedReader.cancel('already complete')).resolves.toBeUndefined();
    expect(naturalReturns).toBe(0);
  });
});
