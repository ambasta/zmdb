import { describe, it, expect } from 'vitest';

import { UnsupportedFeatureError as FtsUnsupportedFeatureError } from './fts/index.ts';
import { UnsupportedFeatureError } from './index.ts';
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
