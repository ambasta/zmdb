// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Runtime validation, rule composition, and serialization. Compiler-backed
// reflection and transforms live under `@zmdb/core/compiler`.

export {
  AssertError,
  assert,
  assertEquals,
  assertShallow,
  equals,
  failWith,
  is,
  isShallow,
  issuesFor,
  random,
  validate,
  validateShallow,
} from '@zmdb/validator';
export { type TypeIR, type ValidateResult, type ValidationIssue } from '@zmdb/validator';

export { coerce, discriminated, evalRule, refine, transform, union, validateObject } from '@zmdb/validator/advanced';
export {
  type Brand,
  type DiscriminatedRule,
  type ObjectMode,
  type RefinePredicate,
  type RefineRule,
  type TransformFn,
  type TransformRule,
  type UnionRule,
} from '@zmdb/validator/advanced';

export {
  assertStringify,
  compileFastStringifier,
  compileStringifier,
  decode,
  parse,
  stringify,
} from '@zmdb/validator/serialization';

export {
  MAX_REGEX_CACHE_SIZE,
  ValidationError,
  getCachedRegExp,
  getEnumSet,
  tags,
  validatePatternComplexity,
} from '@zmdb/validator';
export { type Rule } from '@zmdb/validator';
