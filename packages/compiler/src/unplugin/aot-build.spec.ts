// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// #82: source goes through the real transform and the emitted JavaScript is executed.

import { afterAll, describe, expect, it } from 'vitest';

import { FixtureProject } from '../emit/__testing__/project.js';

const TYPE = '{ number: number; str: string; nested: { a: number } }';

const project = FixtureProject.open();
afterAll(() => project.close());

const { check } = project.build(`const check = (input) => is<${TYPE}>(input);`);

const good = { number: 1, str: 'x', nested: { a: 2 } };
const bad = { number: 1, str: 'x', nested: { a: 'nope' } };

describe('AOT build produces a working inlined validator (#82)', () => {
  it('accepts valid input and rejects invalid input', () => {
    expect(check(good)).toBe(true);
    expect(check(bad)).toBe(false);
  });
});
