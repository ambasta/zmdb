import { ClientRequestError, TransportError } from '../errors/index.js';
import { normalizeClientHeaders } from '../headers/index.js';
import type { ClientRequest, ClientResponse, ClientTransport } from '../types.js';

export type FetchLike = typeof globalThis.fetch;

interface StreamingRequestInit extends RequestInit {
  readonly duplex?: 'half';
}

function fetchFunction(injected: FetchLike | undefined): FetchLike {
  const candidate = injected ?? globalThis.fetch;
  if (typeof candidate !== 'function') {
    throw new ClientRequestError('Fetch is unavailable; inject a ClientTransport or Fetch implementation');
  }
  return candidate;
}

export function createFetchTransport(injected?: FetchLike): ClientTransport {
  const fetch = fetchFunction(injected);

  return async (request: ClientRequest): Promise<ClientResponse> => {
    if (request.headers.cookie !== undefined) {
      throw new ClientRequestError('Fetch cannot guarantee an explicit cookie request header');
    }
    const init: StreamingRequestInit = {
      method: request.method,
      headers: request.headers,
      redirect: 'manual',
      ...(request.body === undefined ? {} : { body: request.body }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(request.body instanceof ReadableStream ? { duplex: 'half' } : {}),
    };

    let response: Response;
    try {
      response = await fetch(request.url, init);
    } catch (error) {
      if (request.signal?.aborted === true) throw request.signal.reason;
      throw new TransportError(undefined, error);
    }
    if (response.status <= 0 || response.type === 'opaqueredirect') {
      throw new TransportError(undefined, new Error('Fetch returned an opaque redirect or unusable status'));
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    return Object.freeze({
      status: response.status,
      headers: normalizeClientHeaders(headers),
      body: response.body,
    });
  };
}
