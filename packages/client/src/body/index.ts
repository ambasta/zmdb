import { ClientRequestError } from '../errors/index.js';
import type { ClientBody, ClientBytes } from '../types.js';

export const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_ERROR_BODY_BYTES = 8 * 1024;

export type ClientBodyKind = 'json' | 'text' | 'bytes' | 'stream' | 'empty';

const TEXT_BODY_KIND: ClientBodyKind = 'text';

function isClientBytes(value: unknown): value is ClientBytes {
  return value instanceof Uint8Array && value.buffer instanceof ArrayBuffer;
}

export function prepareClientBody(kind: ClientBodyKind, value: unknown): ClientBody | undefined {
  if (kind === 'empty') {
    if (value !== undefined) throw new ClientRequestError('An empty request body must be undefined');
    return undefined;
  }
  if (kind === TEXT_BODY_KIND) {
    if (typeof value !== 'string') throw new ClientRequestError('A text request body must be a string');
    return value;
  }
  if (kind === 'bytes') {
    if (!isClientBytes(value)) {
      throw new ClientRequestError('A bytes request body must be a Uint8Array');
    }
    return value;
  }
  if (kind === 'stream') {
    if (!(value instanceof ReadableStream)) {
      throw new ClientRequestError('A stream request body must be a ReadableStream');
    }
    return value;
  }
  try {
    const serialized = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'number' && !Number.isFinite(item)) {
        throw new ClientRequestError('A JSON request body must not contain a non-finite number');
      }
      return item;
    });
    if (serialized === undefined) {
      throw new ClientRequestError('A JSON request body must have a serialisable top-level value');
    }
    return serialized;
  } catch (error) {
    if (error instanceof ClientRequestError) throw error;
    throw new ClientRequestError('A JSON request body could not be serialised', { cause: error });
  }
}

export function assertPositiveByteLimit(value: number, option: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ClientRequestError(`${option} must be a positive safe integer`);
  }
  return value;
}
