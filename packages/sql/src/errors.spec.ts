// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { QueryCompilerError, UnsupportedFeatureError } from '@zmdb/sql';
import { UnsupportedFeatureError as SchemaObjectsUnsupportedFeatureError } from '@zmdb/sql/schema-objects';
import { describe, it, expect } from 'vitest';

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
