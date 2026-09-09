// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

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
