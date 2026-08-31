import { describe, it, expect } from 'vitest';

import { SchemaError, ValidationError, type ValidationIssue } from './errors.ts';
import { SchemaError as RootSchemaError, ValidationError as RootValidationError } from './index.ts';

describe('SchemaError and ValidationError', () => {
  it('instantiates SchemaError as an Error subclass', () => {
    const err = new SchemaError('invalid schema');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SchemaError);
  });

  it('instantiates ValidationError with frozen canonical issues', () => {
    const issue: ValidationIssue = {
      path: 'input.age',
      message: 'invalid value for "age"',
      expected: 'number',
      value: 'twenty',
    };
    const err = new ValidationError('validation failed', [issue]);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.name).toBe('ValidationError');
    expect(err.message).toBe('validation failed');
    expect(err.issues).toHaveLength(1);
    expect(err.issues[0]).toEqual(issue);
    expect(Object.isFrozen(err.issues)).toBe(true);
  });

  it('root exports are identical to module exports', () => {
    expect(RootSchemaError).toBe(SchemaError);
    expect(RootValidationError).toBe(ValidationError);
  });
});
