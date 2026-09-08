import { getResult } from '@zmdb/schema/dto';
import { describe, it, expect } from 'vitest';

describe('GetDTO + Projection (#165)', () => {
  const row = { id: 1, email: 'a@b.com', age: 30 };

  it('getResult with select narrows the row', () => {
    expect(getResult(row, { select: ['id', 'email'] as const })).toEqual({ id: 1, email: 'a@b.com' });
  });

  it('getResult without select ⇒ full row', () => {
    expect(getResult(row)).toEqual(row);
  });
});
