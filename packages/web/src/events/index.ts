// @zmdb/web — typed, app-owned application events (epic #591, spec ./SPEC.md).
// Handlers are registered explicitly, run concurrently, and report failures
// without letting one handler stop another. Durable emission crosses through
// the caller's transaction and the repository outbox.

import '../polyfill.js';
import type { OutboxWriter } from '@zmdb/repository/outbox';
import type { TransactionContext } from '@zmdb/repository/transactions';

/** An application-owned map from event names to payload types. */
export interface EventMap {
  readonly [event: string]: unknown;
}

/** One validator or handler failure observed while dispatching an event. */
export interface EventFailure {
  readonly event: string;
  readonly handler: string;
  readonly error: unknown;
}

/** The settled result of an awaited in-process emission. */
export interface EmitReport {
  readonly delivered: number;
  readonly failures: readonly EventFailure[];
}

/** Construction options for one app-owned event registry. */
export interface EventsOptions<M extends EventMap> {
  readonly onError: (failure: EventFailure) => void;
  readonly validate?: { readonly [K in keyof M]?: (raw: unknown) => M[K] };
  readonly outbox?: (tx: TransactionContext) => OutboxWriter;
}

/** Typed in-process dispatch plus an explicit transactional outbox crossing. */
export interface Events<M extends EventMap> {
  emit<K extends keyof M & string>(event: K, payload: M[K]): void;
  emitAndWait<K extends keyof M & string>(event: K, payload: M[K]): Promise<EmitReport>;
  on<K extends keyof M & string>(event: K, handler: (payload: M[K]) => void | Promise<void>): () => void;
  bind(instance: object): () => void;
  emitInTransaction<K extends keyof M & string>(tx: TransactionContext, event: K, payload: M[K]): Promise<string>;
}

/** A handler declaration recorded by `@OnEvent`. */
export interface ResolvedEventHandler {
  readonly event: string;
  readonly handlerName: string;
}

const EVENT_HANDLERS = Symbol('zmdb.web.events.handlers');

interface EventMetadata {
  [EVENT_HANDLERS]?: ResolvedEventHandler[];
}

interface StoredHandler {
  readonly name: string;
  invoke(payload: unknown): void | Promise<void>;
}

// boundary: @OnEvent is the only writer of the EVENT_HANDLERS slot, so this
// typed view of decorator metadata is sound (ARCHITECTURE.md §2.1).
function eventMetadata(metadata: DecoratorMetadata): EventMetadata {
  return metadata;
}

/** Stage-3 method decorator recording an application-event binding. */
export function OnEvent(event: string) {
  return function (_target: Function, context: ClassMethodDecoratorContext): void {
    const handlerName = typeof context.name === 'string' ? context.name : context.name.toString();
    const view = eventMetadata(context.metadata);
    const own = Object.hasOwn(context.metadata, EVENT_HANDLERS) ? view[EVENT_HANDLERS] : undefined;
    const binding = { event, handlerName };
    if (own === undefined) {
      view[EVENT_HANDLERS] = [...(view[EVENT_HANDLERS] ?? []), binding];
    } else {
      own.push(binding);
    }
  };
}

function handlersDeclaredBy(cls: Function): readonly ResolvedEventHandler[] {
  const metadata = cls[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return [];
  }
  return eventMetadata(metadata)[EVENT_HANDLERS] ?? [];
}

/** Read the bindings declared by a class. Nothing scans or constructs it. */
export function getEventHandlers(cls: abstract new (...args: never[]) => unknown): readonly ResolvedEventHandler[] {
  return handlersDeclaredBy(cls);
}

function storedHandler<P>(
  handler: (payload: P) => void | Promise<void>,
  name = handler.name || '<anonymous>',
): StoredHandler {
  return {
    name,
    async invoke(payload: unknown): Promise<void> {
      // The public `on(event, handler)` signature ties P to the same event key
      // used by the registry; Reflect.apply is the erased runtime crossing.
      await Reflect.apply(handler, undefined, [payload]);
    },
  };
}

function boundHandler(instance: object, declaration: ResolvedEventHandler): StoredHandler {
  const value: unknown = Reflect.get(instance, declaration.handlerName);
  if (typeof value !== 'function') {
    throw new Error(`@zmdb/web: @OnEvent handler "${declaration.handlerName}" is not a callable instance method`);
  }
  return {
    name: declaration.handlerName,
    async invoke(payload: unknown): Promise<void> {
      await Reflect.apply(value, instance, [payload]);
    },
  };
}

function invoke(handler: StoredHandler, payload: unknown): Promise<void> {
  try {
    return Promise.resolve(handler.invoke(payload));
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Build one isolated event registry for an application. */
export function createEvents<M extends EventMap>(options: EventsOptions<M>): Events<M> {
  const handlers = new Map<string, StoredHandler[]>();

  const report = (failure: EventFailure): void => {
    try {
      options.onError(failure);
    } catch {
      // The error sink is the terminal reporting boundary. Its own exception
      // must not turn a fire-and-forget emission into an unhandled rejection.
    }
  };

  const register = (event: string, handler: StoredHandler): (() => void) => {
    const registrations = handlers.get(event);
    if (registrations === undefined) {
      handlers.set(event, [handler]);
    } else {
      registrations.push(handler);
    }

    let active = true;
    return (): void => {
      if (!active) {
        return;
      }
      active = false;
      const current = handlers.get(event);
      if (current === undefined) {
        return;
      }
      const index = current.indexOf(handler);
      if (index >= 0) {
        current.splice(index, 1);
      }
      if (current.length === 0) {
        handlers.delete(event);
      }
    };
  };

  const dispatch = async <K extends keyof M & string>(event: K, payload: M[K]): Promise<EmitReport> => {
    let checked = payload;
    try {
      const validator = options.validate?.[event];
      if (validator !== undefined) {
        checked = validator(payload);
      }
    } catch (error) {
      const failure: EventFailure = { event, handler: 'validate', error };
      report(failure);
      return { delivered: 0, failures: [failure] };
    }

    const registrations = [...(handlers.get(event) ?? [])];
    const settled = await Promise.allSettled(registrations.map(handler => invoke(handler, checked)));
    const failures: EventFailure[] = [];
    let delivered = 0;
    for (let index = 0; index < settled.length; index += 1) {
      const outcome = settled[index];
      const registration = registrations[index];
      if (outcome?.status === 'fulfilled') {
        delivered += 1;
      } else if (outcome !== undefined && registration !== undefined) {
        const failure: EventFailure = {
          event,
          handler: registration.name,
          error: outcome.reason,
        };
        failures.push(failure);
        report(failure);
      }
    }
    return { delivered, failures };
  };

  return {
    emit(event, payload): void {
      void dispatch(event, payload).catch(error => {
        report({ event, handler: '<dispatch>', error });
      });
    },

    emitAndWait: dispatch,

    on(event, handler): () => void {
      return register(event, storedHandler(handler));
    },

    bind(instance): () => void {
      const ctor = instance.constructor;
      const declarations = typeof ctor === 'function' ? handlersDeclaredBy(ctor) : [];
      const disposers = declarations.map(declaration =>
        register(declaration.event, boundHandler(instance, declaration)),
      );
      let active = true;
      return (): void => {
        if (!active) {
          return;
        }
        active = false;
        for (const dispose of disposers) {
          dispose();
        }
      };
    },

    async emitInTransaction(tx, event, payload): Promise<string> {
      if (options.outbox === undefined) {
        throw new Error('@zmdb/web: emitInTransaction requires an outbox writer');
      }
      const encoded = JSON.stringify(payload);
      if (encoded === undefined) {
        throw new Error('@zmdb/web: event payload is not JSON-serializable');
      }
      return options.outbox(tx).write(event, encoded);
    },
  };
}
