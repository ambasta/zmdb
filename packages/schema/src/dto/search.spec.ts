// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { buildSearchResult } from '@zmdb/schema/dto';
import { describe, it, expect } from 'vitest';

const hits = [
  { id: 1, body: 'alpha', _score: 0.9 },
  { id: 2, body: 'beta', _score: 0.5 },
  { id: 3, body: 'gamma', _score: 0.1 },
];

describe('SearchDTO (#171)', () => {
  it('preserves _score on hits and applies limit+1 trim', () => {
    const r = buildSearchResult(hits, { limit: 2 });
    expect(r.hasMore).toBe(true);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]?._score).toBe(0.9);
  });

  it('projects hit fields by select (keeping _score)', () => {
    const r = buildSearchResult(hits, { limit: 5, select: ['id'] as const });
    expect(r.items[0]).toMatchObject({ id: 1 });
  });
});
