import { ValidationError } from '@zmdb/schema-core';
import { describe, expect, it } from 'vitest';

import { executeToolAdapter } from './tool-runtime.js';

describe('@zmdb/ai/tool-runtime', () => {
  it('validates model arguments before the handler runs', async () => {
    const entered: string[] = [];
    const result = await executeToolAdapter(
      'search',
      { q: 42 },
      {
        description: 'Search documents',
        validate: value => {
          if (typeof value !== 'object' || value === null || !('q' in value) || typeof value.q !== 'string') {
            throw new ValidationError('input is not SearchArguments', [
              { path: '$input.q', message: 'expected string', expected: 'string', value },
            ]);
          }
          return { q: value.q };
        },
        execute: input => {
          entered.push(input.q);
          return input.q;
        },
      },
    );

    expect(entered).toStrictEqual([]);
    expect(result).toContain('$input.q: expected string');
  });
});
