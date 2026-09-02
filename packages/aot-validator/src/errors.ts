// The one thing emitted code imports at runtime.
//
// `assert<T>(x)` has to throw something, and the interesting question is *what*. A
// hoisted class in the emitted prelude would make `err instanceof AssertError` false in
// a built bundle and true in dev — the exact class of bug the AOT path exists to avoid,
// since the two paths are supposed to be indistinguishable (REQ-AV-4).
//
// So the emitted prelude imports this module, and it is kept in its own file precisely
// so that import costs a few lines rather than the whole runtime walker.

import type { ValidationIssue } from '@zmdb/schema-core';

export class AssertError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, issues: readonly ValidationIssue[] = []) {
    super(message);
    this.name = 'AssertError';
    this.issues = issues;
  }
}

/** Throw an `AssertError` carrying `issues`; the first issue supplies the message. */
export function failWith(issues: readonly ValidationIssue[]): never {
  const first = issues[0];
  throw new AssertError(first ? first.message : 'validation failed', issues);
}
