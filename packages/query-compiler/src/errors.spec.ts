import { describe, it, expect } from 'vitest';

import { UnsupportedFeatureError as FtsUnsupportedFeatureError } from './fts/index.ts';
import { QueryCompilerError, UnsupportedFeatureError } from './index.ts';
import { UnsupportedFeatureError as SchemaObjectsUnsupportedFeatureError } from './schema-objects/index.ts';

describe('UnsupportedFeatureError', () => {
  it('instantiates with feature and dialect and exposes structured properties', () => {
    const err = new UnsupportedFeatureError('partitioning', 'sqlite');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UnsupportedFeatureError);
    expect(err.name).toBe('UnsupportedFeatureError');
    expect(err.feature).toBe('partitioning');
    expect(err.dialect).toBe('sqlite');
    expect(err.message).toBe('partitioning is not supported on dialect "sqlite"');
  });

  it('submodule error classes are identical to the root error class', () => {
    expect(FtsUnsupportedFeatureError).toBe(UnsupportedFeatureError);
    expect(SchemaObjectsUnsupportedFeatureError).toBe(UnsupportedFeatureError);
  });
});

describe('QueryCompilerError', () => {
  it('is a distinct Error a caller can catch on its own', () => {
    // The two are siblings rather than one extending the other, which is what makes a
    // `catch (e) { if (e instanceof UnsupportedFeatureError) … }` in a driver correct: a
    // dialect gap and a malformed query need different handling, and an `instanceof` that
    // answered true for both would route them to the same place.
    const err = new QueryCompilerError('no columns to insert');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(QueryCompilerError);
    expect(err.name).toBe('QueryCompilerError');
    expect(err.message).toBe('no columns to insert');
    expect(err).not.toBeInstanceOf(UnsupportedFeatureError);
    expect(new UnsupportedFeatureError('partitioning', 'sqlite')).not.toBeInstanceOf(QueryCompilerError);
  });
});
