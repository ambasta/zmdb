import { assertNoTransportOwnedHeaders, mergeClientHeaders, normalizeClientHeaders } from '@zmdb/client/headers';
import { describe, expect, it } from 'vitest';

describe('@zmdb/client headers', () => {
  it('normalises names and collapses identical values', () => {
    expect(normalizeClientHeaders({ Accept: 'application/json', 'X-Request-ID': 'one' })).toEqual({
      accept: 'application/json',
      'x-request-id': 'one',
    });
    expect(mergeClientHeaders({ 'X-ID': 'one' }, { 'x-id': 'one' })).toEqual({ 'x-id': 'one' });
  });

  it('rejects conflicts and control characters before transport', () => {
    expect(() => mergeClientHeaders({ 'x-id': 'one' }, { 'X-ID': 'two' })).toThrow(/Conflicting/u);
    expect(() => normalizeClientHeaders({ 'x-id': 'one\ninjected' })).toThrow(/Invalid value/u);
    expect(() => normalizeClientHeaders({ 'bad header': 'one' })).toThrow(/Invalid HTTP header name/u);
  });

  it('keeps framing headers transport-owned', () => {
    expect(() => assertNoTransportOwnedHeaders({ host: 'api.example.test' })).toThrow(/owned by the transport/u);
    expect(() => assertNoTransportOwnedHeaders({ 'transfer-encoding': 'chunked' })).toThrow(/owned by the transport/u);
  });
});
