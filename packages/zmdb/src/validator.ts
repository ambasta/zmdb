// Runtime validation, rule composition, and serialization. Compiler-backed
// reflection and transforms live under `zmdb/compiler`.

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
} from '@zmdb/aot-validator/utilities';
export type { TypeIR, ValidateResult, ValidationIssue } from '@zmdb/aot-validator/utilities';

export {
  coerce,
  discriminated,
  evalRule,
  refine,
  transform,
  union,
  validateObject,
} from '@zmdb/aot-validator/advanced';
export type {
  Brand,
  DiscriminatedRule,
  ObjectMode,
  RefinePredicate,
  RefineRule,
  TransformFn,
  TransformRule,
  UnionRule,
} from '@zmdb/aot-validator/advanced';

export {
  assertStringify,
  compileFastStringifier,
  compileStringifier,
  decode,
  parse,
  stringify,
} from '@zmdb/aot-validator/serialization';
export type { ParseResult } from '@zmdb/aot-validator/serialization';

export {
  MAX_REGEX_CACHE_SIZE,
  ValidationError,
  getCachedRegExp,
  getEnumSet,
  getRegExp,
  tags,
  validatePatternComplexity,
} from '@zmdb/aot-validator';
export type { Rule } from '@zmdb/aot-validator';
