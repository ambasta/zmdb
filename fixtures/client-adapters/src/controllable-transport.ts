import type { ClientBytes, ClientHeaders, ClientRequest, ClientResponse, ClientTransport } from '@zmdb/client';

export interface HeldAdapterRequest {
  readonly request: ClientRequest;
  respondJson(status: number, value: unknown, headers?: ClientHeaders): void;
  respondText(status: number, value: string, headers?: ClientHeaders): void;
  respondEmpty(status?: number, headers?: ClientHeaders): void;
  fail(error: unknown): void;
}

export interface ControllableAdapterTransport {
  readonly transport: ClientTransport;
  readonly requests: readonly ClientRequest[];
  readonly pending: number;
  nextRequest(): Promise<HeldAdapterRequest>;
}

interface RequestWaiter {
  resolve(request: HeldAdapterRequest): void;
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

export function createControllableAdapterTransport(): ControllableAdapterTransport {
  const observed: ClientRequest[] = [];
  const held: HeldAdapterRequest[] = [];
  const waiters: RequestWaiter[] = [];

  const transport: ClientTransport = request =>
    new Promise<ClientResponse>((resolve, reject) => {
      observed.push(request);
      let settled = false;
      const finish = (complete: () => void): void => {
        if (settled) return;
        settled = true;
        complete();
      };
      const pending: HeldAdapterRequest = Object.freeze({
        request,
        respondJson(status: number, value: unknown, headers: ClientHeaders = {}) {
          finish(() =>
            resolve(response(status, { 'content-type': 'application/json', ...headers }, JSON.stringify(value))),
          );
        },
        respondText(status: number, value: string, headers: ClientHeaders = {}) {
          finish(() => resolve(response(status, { 'content-type': 'text/plain', ...headers }, value)));
        },
        respondEmpty(status: number = 204, headers: ClientHeaders = {}) {
          finish(() => resolve(response(status, headers, undefined)));
        },
        fail(error: unknown) {
          finish(() => reject(error));
        },
      });
      const waiter = waiters.shift();
      if (waiter === undefined) held.push(pending);
      else waiter.resolve(pending);
    });

  return Object.freeze({
    transport,
    get requests() {
      return Object.freeze([...observed]);
    },
    get pending() {
      return held.length;
    },
    nextRequest() {
      const pending = held.shift();
      if (pending !== undefined) return Promise.resolve(pending);
      return new Promise<HeldAdapterRequest>(resolve => {
        waiters.push({ resolve });
      });
    },
  });
}
