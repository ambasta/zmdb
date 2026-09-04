// Tests (#309) for WS/SSE gateways — RED first (gateways exports absent).
// Subscription metadata, dispatch with typed message ctx, SSE framing.
// Per packages/web/src/gateways/SPEC.md.
import { describe, it, expect } from 'vitest';

import { Gateway, Subscribe, getSubscriptions, createGatewayDispatcher, sseStream, type MessageCtx } from './index.js';

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
});
