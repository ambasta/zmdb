import { describe, it, expect } from 'vitest';

import { postgresDialect } from '../testing/official-dialects.fixture.js';
import { createSequenceDdl } from './index.js';

describe('sequences DDL (#106)', () => {
  it('bare sequence', () => {
    expect(createSequenceDdl({ name: 'order_no' }, postgresDialect)).toBe('CREATE SEQUENCE "order_no"');
  });
  it('with start + increment', () => {
    expect(createSequenceDdl({ name: 's', start: 100, increment: 10 }, postgresDialect)).toBe(
      'CREATE SEQUENCE "s" START 100 INCREMENT 10',
    );
  });
});
