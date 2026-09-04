import { describe, it, expect } from 'vitest';

import { project } from './index.js';

describe('typed select()/projection narrowing (#185)', () => {
  const row = { id: 1, email: 'a@b.com', age: 30 };

  it('project picks only the selected columns, in order', () => {
    expect(project(row, ['email', 'id'] as const)).toEqual({ email: 'a@b.com', id: 1 });
  });

  it('project undefined ⇒ passthrough (same row)', () => {
    expect(project(row, undefined)).toEqual(row);
  });

  it('project does not mutate the input', () => {
    const copy = { ...row };
    project(row, ['id'] as const);
    expect(row).toEqual(copy);
  });
});
