// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { buildListResult } from '@zmdb/schema/dto';
import { describe, it, expect } from 'vitest';

const rows = [
  { id: 1, email: 'a@b.com' },
  { id: 2, email: 'c@d.com' },
  { id: 3, email: 'e@f.com' },
];

describe('ListDTO + ListResult (#168)', () => {
  it('limit+1 trim ⇒ hasMore true and extra row dropped', () => {
    const r = buildListResult(rows, { limit: 2 });
    expect(r.items).toHaveLength(2);
    expect(r.hasMore).toBe(true);
    expect(r.items.map(x => x.id)).toEqual([1, 2]);
  });

  it('rows within limit ⇒ hasMore false', () => {
    const r = buildListResult(rows.slice(0, 2), { limit: 5 });
    expect(r.hasMore).toBe(false);
    expect(r.items).toHaveLength(2);
  });

  it('no limit ⇒ hasMore false, all rows', () => {
    const r = buildListResult(rows);
    expect(r.hasMore).toBe(false);
    expect(r.items).toHaveLength(3);
  });

  it('projects items by select', () => {
    const r = buildListResult(rows, { limit: 5, select: ['id'] as const });
    expect(r.items[0]).toEqual({ id: 1 });
  });

  it('total attached when provided', () => {
    const r = buildListResult(rows.slice(0, 2), { limit: 5, total: 42 });
    expect(r.total).toBe(42);
  });
});
