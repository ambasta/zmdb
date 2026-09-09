// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { project } from '@zmdb/schema/dto';
import { describe, it, expect } from 'vitest';

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
