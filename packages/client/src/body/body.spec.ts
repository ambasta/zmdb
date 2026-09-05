import { DEFAULT_MAX_ERROR_BODY_BYTES, DEFAULT_MAX_RESPONSE_BYTES, prepareClientBody } from '@zmdb/client/body';
import { describe, expect, it } from 'vitest';

describe('@zmdb/client request bodies', () => {
  it('prepares JSON, text, bytes, stream, and empty bodies without changing ownership', () => {
    const bytes = Uint8Array.of(1, 2, 3);
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>();
    expect(prepareClientBody('json', { ok: true })).toBe('{"ok":true}');
    expect(prepareClientBody('text', 'ready')).toBe('ready');
    expect(prepareClientBody('bytes', bytes)).toBe(bytes);
    expect(prepareClientBody('stream', stream)).toBe(stream);
    expect(prepareClientBody('empty', undefined)).toBeUndefined();
  });

  it('distinguishes an empty body from JSON null', () => {
    expect(prepareClientBody('empty', undefined)).toBeUndefined();
    expect(prepareClientBody('json', null)).toBe('null');
  });

  it('refuses values that do not match the selected representation', () => {
    expect(() => prepareClientBody('empty', null)).toThrow(/undefined/u);
    expect(() => prepareClientBody('text', 1)).toThrow(/string/u);
    expect(() => prepareClientBody('bytes', 'bytes')).toThrow(/Uint8Array/u);
    expect(() => prepareClientBody('stream', 'stream')).toThrow(/ReadableStream/u);
    expect(() => prepareClientBody('json', undefined)).toThrow(/top-level/u);
    expect(() => prepareClientBody('json', { value: Number.NaN })).toThrow(/non-finite/u);
  });

  it('publishes the frozen response limits', () => {
    expect(DEFAULT_MAX_RESPONSE_BYTES).toBe(8 * 1024 * 1024);
    expect(DEFAULT_MAX_ERROR_BODY_BYTES).toBe(8 * 1024);
  });
});
