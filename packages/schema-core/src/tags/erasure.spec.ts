// REQ-TF-3 — tags are zero-cost. Declaring a table as a type must add nothing to
// the shipped bundle, so this is checked two ways rather than asserted in prose.

import { transform } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('the tag vocabulary is type-only', () => {
  it('contributes no runtime export', async () => {
    // Every member is `declare const … : unique symbol` or `export type`, so the
    // module's namespace object is empty once the types are erased. If a helper
    // function or a real `const` is ever added here, that value shows up and this
    // fails — which is the point: a tag that exists at runtime is a tag that can
    // be imported, bundled, and shipped to a browser.
    const tags: Record<string, unknown> = await import('./index.ts');
    expect(Object.keys(tags)).toEqual([]);
  });

  it('and so do the derivations built on it', async () => {
    const derive: Record<string, unknown> = await import('../derive/index.ts');
    expect(Object.keys(derive)).toEqual([]);
  });
});

describe('a tagged declaration compiles to the same bytes as an untagged one', () => {
  // The strong form of REQ-TF-3: not "the tags module is empty" but "adding tags
  // to a declaration changes no emitted byte". Both fixtures carry identical
  // runtime code; only the type annotations differ.
  const runtime = `
export function greet(u: User): string {
  return \`hello \${u.email}\`;
}
export const DEFAULT_AGE = 18;
`;

  const tagged = `
import type { HasDefault, Length, Min, PrimaryKey, Serial, Sql, Table, Unique } from './index.ts';

export interface User extends Table<'users'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<255> & Unique;
  age: number & Sql<'integer'> & Min<18> & HasDefault;
}
${runtime}`;

  const untagged = `
export interface User {
  id: number;
  email: string;
  age: number;
}
${runtime}`;

  it('emits byte-identical JavaScript', async () => {
    const compile = async (source: string): Promise<string> =>
      (await transform(source, { loader: 'ts', format: 'esm', target: 'es2023' })).code;
    const [a, b] = await Promise.all([compile(tagged), compile(untagged)]);
    expect(a).toBe(b);
  });

  it('and emits no reference to a tag', async () => {
    const { code } = await transform(tagged, { loader: 'ts', format: 'esm', target: 'es2023' });
    for (const name of ['Table', 'Sql', 'Serial', 'PrimaryKey', 'Unique', 'Length', 'Min', 'HasDefault', 'zmdb']) {
      expect(code).not.toContain(name);
    }
  });
});
