import type { ClientBytes, ClientHeaders, ClientRequest, ClientResponse, ClientTransport } from '@zmdb/client';

export type HeldAdapterRequestState = 'aborted' | 'failed' | 'pending' | 'responded';

export type AdapterRequestSettlement =
  | {
      readonly sequence: number;
      readonly kind: 'response';
      readonly status: number;
    }
  | {
      readonly sequence: number;
      readonly kind: 'abort' | 'failure';
      readonly reason: unknown;
    };

export interface HeldAdapterRequest {
  readonly sequence: number;
  readonly request: ClientRequest;
  readonly state: HeldAdapterRequestState;
  readonly abortReason: unknown;
  whenAborted(): Promise<unknown>;
  respondJson(status: number, value: unknown, headers?: ClientHeaders): void;
  respondText(status: number, value: string, headers?: ClientHeaders): void;
  respondEmpty(status?: number, headers?: ClientHeaders): void;
  fail(error: unknown): void;
}

export interface ControllableAdapterTransport {
  readonly transport: ClientTransport;
  readonly requests: readonly ClientRequest[];
  readonly heldRequests: readonly HeldAdapterRequest[];
  readonly settlements: readonly AdapterRequestSettlement[];
  readonly pending: number;
  nextRequest(): Promise<HeldAdapterRequest>;
  whenIdle(): Promise<void>;
  assertIdle(context?: string): void;
}

interface RequestWaiter {
  resolve(request: HeldAdapterRequest): void;
}

interface IdleWaiter {
  resolve(): void;
}

const encoder = new TextEncoder();

function body(value: string): ReadableStream<ClientBytes> {
  const bytes = encoder.encode(value);
  return new ReadableStream<ClientBytes>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function response(status: number, headers: ClientHeaders, value: string | undefined): ClientResponse {
  return Object.freeze({
    status,
    headers: Object.freeze({ ...headers }),
    body: value === undefined ? null : body(value),
  });
}

function requestLabel(request: HeldAdapterRequest): string {
  return `#${String(request.sequence)} ${request.request.method} ${request.request.url} (${request.state})`;
}

export function createControllableAdapterTransport(): ControllableAdapterTransport {
  const observed: ClientRequest[] = [];
  const handles: HeldAdapterRequest[] = [];
  const undelivered: HeldAdapterRequest[] = [];
  const active = new Map<number, HeldAdapterRequest>();
  const settlements: AdapterRequestSettlement[] = [];
  const requestWaiters: RequestWaiter[] = [];
  const idleWaiters: IdleWaiter[] = [];
  let sequence = 0;

  const notifyIdle = (): void => {
    if (active.size !== 0) return;
    for (const waiter of idleWaiters.splice(0)) waiter.resolve();
  };

  const transport: ClientTransport = request =>
    new Promise<ClientResponse>((resolve, reject) => {
      observed.push(request);
      sequence += 1;
      const currentSequence = sequence;
      let state: HeldAdapterRequestState = 'pending';
      let abortReason: unknown;
      let resolveAbort: ((reason: unknown) => void) | undefined;
      const aborted = new Promise<unknown>(resolveReason => {
        resolveAbort = resolveReason;
      });

      const finish = (
        nextState: Exclude<HeldAdapterRequestState, 'pending'>,
        settlement: AdapterRequestSettlement,
        complete: () => void,
      ): void => {
        if (state !== 'pending') return;
        state = nextState;
        request.signal?.removeEventListener('abort', onAbort);
        active.delete(currentSequence);
        settlements.push(Object.freeze(settlement));
        complete();
        notifyIdle();
      };

      const onAbort = (): void => {
        const reason = request.signal?.reason;
        abortReason = reason;
        resolveAbort?.(reason);
        finish('aborted', { sequence: currentSequence, kind: 'abort', reason }, () => {
          reject(reason);
        });
      };

      const held: HeldAdapterRequest = Object.freeze({
        sequence: currentSequence,
        request,
        get state() {
          return state;
        },
        get abortReason() {
          return abortReason;
        },
        whenAborted() {
          return aborted;
        },
        respondJson(status: number, value: unknown, headers: ClientHeaders = {}) {
          finish('responded', { sequence: currentSequence, kind: 'response', status }, () => {
            resolve(response(status, { 'content-type': 'application/json', ...headers }, JSON.stringify(value)));
          });
        },
        respondText(status: number, value: string, headers: ClientHeaders = {}) {
          finish('responded', { sequence: currentSequence, kind: 'response', status }, () => {
            resolve(response(status, { 'content-type': 'text/plain', ...headers }, value));
          });
        },
        respondEmpty(status: number = 204, headers: ClientHeaders = {}) {
          finish('responded', { sequence: currentSequence, kind: 'response', status }, () => {
            resolve(response(status, headers, undefined));
          });
        },
        fail(error: unknown) {
          finish('failed', { sequence: currentSequence, kind: 'failure', reason: error }, () => {
            reject(error);
          });
        },
      });

      handles.push(held);
      active.set(currentSequence, held);
      const waiter = requestWaiters.shift();
      if (waiter === undefined) undelivered.push(held);
      else waiter.resolve(held);

      if (request.signal?.aborted === true) onAbort();
      else request.signal?.addEventListener('abort', onAbort, { once: true });
    });

  return Object.freeze({
    transport,
    get requests() {
      return Object.freeze([...observed]);
    },
    get heldRequests() {
      return Object.freeze([...handles]);
    },
    get settlements() {
      return Object.freeze([...settlements]);
    },
    get pending() {
      return active.size;
    },
    nextRequest() {
      const pending = undelivered.shift();
      if (pending !== undefined) return Promise.resolve(pending);
      return new Promise<HeldAdapterRequest>(resolve => {
        requestWaiters.push({ resolve });
      });
    },
    whenIdle() {
      if (active.size === 0) return Promise.resolve();
      return new Promise<void>(resolve => {
        idleWaiters.push({ resolve });
      });
    },
    assertIdle(context: string = 'adapter transport') {
      if (active.size === 0) return;
      const pending = [...active.values()].map(requestLabel).join(', ');
      throw new Error(`${context} leaked ${String(active.size)} request(s): ${pending}`);
    },
  });
}
