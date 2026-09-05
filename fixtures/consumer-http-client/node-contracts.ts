import { createClientRuntime, createFetchTransport, type ClientResponse, type GeneratedOperation } from '@zmdb/client';

interface Widget {
  readonly id: string;
}

declare const operation: GeneratedOperation<{ readonly id: string }, Widget>;
declare const response: ClientResponse;

export const transport = createFetchTransport(fetch);
export const runtime = createClientRuntime({ baseUrl: new URL('https://api.example.test'), transport });
export const result: Promise<Widget> = runtime.call(operation, { id: 'one' });
export const status: number = response.status;
