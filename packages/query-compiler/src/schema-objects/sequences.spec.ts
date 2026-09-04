import { describe, it, expect } from 'vitest';

import { createSequenceDdl } from './index.js';

describe('sequences DDL (#106)', () => {
  it('bare sequence', () => {
    expect(createSequenceDdl({ name: 'order_no' }, 'postgres')).toBe('CREATE SEQUENCE "order_no"');
  });
  it('with start + increment', () => {
    expect(createSequenceDdl({ name: 's', start: 100, increment: 10 }, 'postgres')).toBe(
      'CREATE SEQUENCE "s" START 100 INCREMENT 10',
    );
  });
});
