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
  makeRng,
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

export { assertStringify, decode, parse, stringify } from '@zmdb/validator/serialization';
export { type ParseResult } from '@zmdb/validator/serialization';

export {
  MAX_REGEX_CACHE_SIZE,
  ValidationError,
  getCachedRegExp,
  getEnumSet,
  getRegExp,
  tags,
  validatePatternComplexity,
} from '@zmdb/validator';
export { type Rule } from '@zmdb/validator';
