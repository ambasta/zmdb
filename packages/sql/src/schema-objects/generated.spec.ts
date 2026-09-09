// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { generatedColumnDdl } from '@zmdb/sql/schema-objects';
import { describe, it, expect } from 'vitest';

import { postgresDialect } from '../testing/official-dialects.fixture.js';

describe('generated columns DDL (#109)', () => {
  it('stored generated column', () => {
    expect(
      generatedColumnDdl(
        { name: 'full_name', type: 'text', expression: "first || ' ' || last", stored: true },
        postgresDialect,
      ),
    ).toBe(`"full_name" text GENERATED ALWAYS AS (first || ' ' || last) STORED`);
  });
  it('virtual generated column (no STORED)', () => {
    expect(generatedColumnDdl({ name: 'area', type: 'numeric', expression: 'w * h' }, postgresDialect)).toBe(
      '"area" numeric GENERATED ALWAYS AS (w * h)',
    );
  });
});
