// @zmdb/web — WebSocket & SSE gateways (epic #307, spec ./SPEC.md). @Gateway/
// @Subscribe store handlers in context.metadata; a dispatcher routes events with
// a typed message ctx; sseStream frames an async iterable as SSE. No ws
// dependency, no reflection, no `as` on the consumer surface.

import '../polyfill.js';

/** The context a subscribed handler receives. */
export interface MessageCtx<T = unknown> {
  readonly event: string;
  readonly data: T;
}

/** A recorded event subscription. */
export interface Subscription {
  readonly event: string;
  readonly handlerName: string;
}

const NAMESPACE = Symbol('zmdb.web.gateway.namespace');
const SUBSCRIPTIONS = Symbol('zmdb.web.gateway.subscriptions');

interface GatewayMetadata {
  [NAMESPACE]?: string;
  [SUBSCRIPTIONS]?: Subscription[];
}

// boundary: our @Gateway/@Subscribe decorators are the only writers of these
// slots, so viewing the record through GatewayMetadata is sound (§2.1).
function gatewayView(metadata: DecoratorMetadata): GatewayMetadata {
  return metadata;
}

/** Stage-3 class decorator: mark a gateway with an optional namespace. */
export function Gateway(namespace = '') {
  return function <T extends abstract new (...args: never[]) => unknown>(
    _target: T,
    context: ClassDecoratorContext<T>,
  ): void {
    gatewayView(context.metadata)[NAMESPACE] = namespace;
  };
}

/** Stage-3 method decorator: subscribe the method to an event. */
export function Subscribe(event: string) {
  return function (_target: (...args: never[]) => unknown, context: ClassMethodDecoratorContext): void {
    const handlerName = typeof context.name === 'string' ? context.name : context.name.toString();
    const view = gatewayView(context.metadata);
    const existing = view[SUBSCRIPTIONS];
    if (existing === undefined) {
      view[SUBSCRIPTIONS] = [{ event, handlerName }];
    } else {
      existing.push({ event, handlerName });
    }
  };
}

/** Read a gateway class's subscriptions (declaration order). No reflection. */
export function getSubscriptions(gateway: abstract new (...args: never[]) => unknown): readonly Subscription[] {
  const metadata = gateway[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return [];
  }
  return gatewayView(metadata)[SUBSCRIPTIONS] ?? [];
}

type MessageHandler = (ctx: MessageCtx) => unknown;

/** A dispatcher routing an event+message to the gateway's matching handler. */
export interface GatewayDispatcher {
  dispatch(event: string, data: unknown): Promise<unknown>;
}

/** Build a dispatcher for a gateway instance. */
export function createGatewayDispatcher(gateway: object): GatewayDispatcher {
  const ctor = gateway.constructor;
  const subs = typeof ctor === 'function' ? getSubscriptions(gatewayClass(ctor)) : [];
  const byEvent = new Map<string, string>();
  for (const sub of subs) {
    byEvent.set(sub.event, sub.handlerName);
  }
  return {
    async dispatch(event: string, data: unknown): Promise<unknown> {
      const handlerName = byEvent.get(event);
      if (handlerName === undefined) {
        return undefined;
      }
      const handler = readMessageHandler(gateway, handlerName);
      if (handler === undefined) {
        return undefined;
      }
      return handler({ event, data });
    },
  };
}

type GatewayClass = abstract new (...args: never[]) => unknown;

// boundary: an instance's `.constructor` carries the gateway metadata; narrowing
// it for getSubscriptions is sound (§2.1).
function gatewayClass(ctor: Function): GatewayClass {
  return ctor as GatewayClass;
}

// boundary: @Subscribe only records names of the gateway's own methods; reading
// one by name and calling it as a MessageHandler is sound (§2.1).
function readMessageHandler(gateway: object, name: string): MessageHandler | undefined {
  const value = Reflect.get(gateway, name);
  if (typeof value !== 'function') {
    return undefined;
  }
  const bound = value.bind(gateway);
  return bound as MessageHandler;
}

/** A Server-Sent-Events frame. */
export interface SseFrame<T = unknown> {
  readonly event?: string;
  readonly data: T;
}

/** Turn an async iterable of frames into an SSE-framed byte stream. */
export function sseStream(source: AsyncIterable<SseFrame>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }
      const prefix = value.event === undefined ? '' : `event: ${value.event}\n`;
      controller.enqueue(encoder.encode(`${prefix}data: ${JSON.stringify(value.data)}\n\n`));
    },
  });
}
