import { createClientRuntime, type ClientHeaders, type GeneratedOperation } from '@zmdb/client';
import { createFakeClientTransport } from '@zmdb/client/testing';

declare const operation: GeneratedOperation<void, string>;

const fake = createFakeClientTransport();
export const runtime = createClientRuntime({ baseUrl: '/api', transport: fake.transport });
export const result: Promise<string> = runtime.call(operation, undefined);
export const headers: ClientHeaders = { accept: 'text/plain' };
export const next = fake.nextRequest();
