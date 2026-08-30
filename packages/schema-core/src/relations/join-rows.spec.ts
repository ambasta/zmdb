import { describe, it, expect, expectTypeOf } from 'vitest';
import { aliasRow, type JoinRow } from './index.ts';

interface Emp {
  id: number;
  recipient_id: number;
}
interface Recipient {
  r_id: number;
  r_name: string;
}

describe('typed join result rows (#193)', () => {
  it('aliasRow renames mapped columns, keeps others, non-mutating', () => {
    const row = { id: 1, recipient_id: 2, r_id: 2, r_name: 'x' };
    const out = aliasRow(row, { r_id: 'recipientId', r_name: 'recipientName' });
    expect(out).toEqual({ id: 1, recipient_id: 2, recipientId: 2, recipientName: 'x' });
    expect(row).toEqual({ id: 1, recipient_id: 2, r_id: 2, r_name: 'x' }); // unchanged
  });

  it('aliasRow with empty map returns an equal object', () => {
    const row = { id: 1 };
    expect(aliasRow(row, {})).toEqual({ id: 1 });
  });

  it('type-level: JoinRow left ⇒ joined partial; inner ⇒ joined required', () => {
    expectTypeOf<JoinRow<Emp, Recipient, 'left'>['r_name']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<JoinRow<Emp, Recipient, 'inner'>['r_name']>().toEqualTypeOf<string>();
  });
});
