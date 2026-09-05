import type { ClientRequest, ClientResponse, ClientTransport } from '../types.js';

export interface HeldClientRequest {
  readonly request: ClientRequest;
  respond(response: ClientResponse): void;
  fail(error: unknown): void;
}

export interface FakeClientTransport {
  readonly transport: ClientTransport;
  readonly requests: readonly ClientRequest[];
  nextRequest(): Promise<HeldClientRequest>;
}

interface RequestWaiter {
  resolve(request: HeldClientRequest): void;
}

export function createFakeClientTransport(): FakeClientTransport {
  const observed: ClientRequest[] = [];
  const held: HeldClientRequest[] = [];
  const waiters: RequestWaiter[] = [];

  const transport: ClientTransport = request =>
    new Promise<ClientResponse>((resolve, reject) => {
      observed.push(request);
      let settled = false;
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        reject(request.signal?.reason);
      };
      request.signal?.addEventListener('abort', onAbort, { once: true });
      const pending: HeldClientRequest = Object.freeze({
        request,
        respond(response: ClientResponse) {
          if (settled) return;
          settled = true;
          request.signal?.removeEventListener('abort', onAbort);
          resolve(response);
        },
        fail(error: unknown) {
          if (settled) return;
          settled = true;
          request.signal?.removeEventListener('abort', onAbort);
          reject(error);
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
    nextRequest() {
      const pending = held.shift();
      if (pending !== undefined) return Promise.resolve(pending);
      return new Promise<HeldClientRequest>(resolve => {
        waiters.push({ resolve });
      });
    },
  });
}
