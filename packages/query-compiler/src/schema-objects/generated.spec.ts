import { describe, it, expect } from 'vitest';

import { postgresDialect } from '../testing/official-dialects.fixture.js';
import { generatedColumnDdl } from './index.js';

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
