import { isRecord, ValidationError, type CoreSchema, type ValidationIssue } from '@zmdb/schema-core';
import { shapeOfVariant } from '@zmdb/schema-core/ir';

export interface CompiledValidator {
  validateCreate(payload: unknown): Record<string, unknown>;
  validateUpdate(payload: unknown): Record<string, unknown>;
}

type FieldChecker = (obj: Record<string, unknown>, out: Record<string, unknown>, issues: ValidationIssue[]) => void;

function composeFieldCheckers(checkers: FieldChecker[]): FieldChecker {
  if (checkers.length === 0) return () => {};
  if (checkers.length === 1) {
    const c0 = checkers[0];
    return c0 ? (obj, out, issues) => c0(obj, out, issues) : () => {};
  }
  if (checkers.length === 2) {
    const c0 = checkers[0];
    const c1 = checkers[1];
    return (obj, out, issues) => {
      if (c0) c0(obj, out, issues);
      if (c1) c1(obj, out, issues);
    };
  }
  if (checkers.length === 3) {
    const c0 = checkers[0];
    const c1 = checkers[1];
    const c2 = checkers[2];
    return (obj, out, issues) => {
      if (c0) c0(obj, out, issues);
      if (c1) c1(obj, out, issues);
      if (c2) c2(obj, out, issues);
    };
  }
  if (checkers.length === 4) {
    const c0 = checkers[0];
    const c1 = checkers[1];
    const c2 = checkers[2];
    const c3 = checkers[3];
    return (obj, out, issues) => {
      if (c0) c0(obj, out, issues);
      if (c1) c1(obj, out, issues);
      if (c2) c2(obj, out, issues);
      if (c3) c3(obj, out, issues);
    };
  }
  const mid = Math.floor(checkers.length / 2);
  const left = composeFieldCheckers(checkers.slice(0, mid));
  const right = composeFieldCheckers(checkers.slice(mid));
  return (obj, out, issues) => {
    left(obj, out, issues);
    right(obj, out, issues);
  };
}

export function compileSchemaValidator(schema: CoreSchema<string>): CompiledValidator {
  const ir = schema.ir;

  const createShape = shapeOfVariant(ir, 'create');
  const updateShape = shapeOfVariant(ir, 'update');

  const acceptedCreate = new Set(createShape.map(({ column }) => column.name));
  const acceptedUpdate = new Set(updateShape.map(({ column }) => column.name));

  function buildCheckers(shape: typeof createShape): FieldChecker {
    const checkers: FieldChecker[] = [];

    for (const { column: col, optional } of shape) {
      const name = col.name;
      const path = `input.${name}`;
      const nullable = col.nullable;
      const enumList = col.enum;
      const enumSet = enumList ? new Set(enumList) : undefined;
      const expectedType = enumList
        ? enumList.map(v => JSON.stringify(v)).join(' | ')
        : col.sql === 'text' || col.sql === 'varchar'
          ? 'string'
          : col.sql === 'integer' || col.sql === 'serial' || col.sql === 'numeric'
            ? 'number'
            : col.sql === 'bigint'
              ? 'bigint | number'
              : col.sql === 'boolean'
                ? 'boolean'
                : col.sql === 'timestamp'
                  ? 'Date'
                  : col.sql === 'json'
                    ? 'object | array'
                    : String(col.sql);

      const constraints = col.constraints;
      const patternStr = constraints.pattern;
      const patternRegex = patternStr ? new RegExp(patternStr) : undefined;
      const minLength = constraints.minLength;
      const maxLength = constraints.maxLength ?? col.length;
      const min = constraints.minimum;
      const max = constraints.maximum;

      checkers.push((obj, out, issues) => {
        const val = obj[name];
        if (val === undefined) {
          if (!optional) {
            issues.push({ path, message: `expected ${expectedType}`, expected: expectedType, value: undefined });
          }
          return;
        }

        if (val === null) {
          if (nullable) {
            out[name] = null;
          } else {
            issues.push({ path, message: `expected ${expectedType}`, expected: expectedType, value: null });
          }
          return;
        }

        if (enumSet) {
          if (typeof val !== 'string' || !enumSet.has(val)) {
            issues.push({ path, message: `expected ${expectedType}`, expected: expectedType, value: val });
            return;
          }
          out[name] = val;
          return;
        }

        switch (col.sql) {
          case 'text':
          case 'varchar':
          case 'jsonEnum': {
            if (typeof val !== 'string') {
              issues.push({ path, message: `expected ${expectedType}`, expected: expectedType, value: val });
              return;
            }
            if (patternRegex && !patternRegex.test(val)) {
              issues.push({
                path,
                message: `expected pattern ${patternStr}`,
                expected: `pattern ${patternStr}`,
                value: val,
              });
              return;
            }
            if (minLength !== undefined && val.length < minLength) {
              issues.push({
                path,
                message: `expected minLength ${minLength}`,
                expected: `minLength ${minLength}`,
                value: val,
              });
              return;
            }
            if (maxLength !== undefined && val.length > maxLength) {
              issues.push({
                path,
                message: `expected maxLength ${maxLength}`,
                expected: `maxLength ${maxLength}`,
                value: val,
              });
              return;
            }
            out[name] = val;
            return;
          }
          case 'integer':
          case 'serial':
          case 'numeric':
          case 'bigint': {
            if (typeof val !== 'number' && typeof val !== 'bigint') {
              issues.push({ path, message: `expected ${expectedType}`, expected: expectedType, value: val });
              return;
            }
            const numVal = Number(val);
            if (min !== undefined && numVal < min) {
              issues.push({ path, message: `expected minimum ${min}`, expected: `minimum ${min}`, value: val });
              return;
            }
            if (max !== undefined && numVal > max) {
              issues.push({ path, message: `expected maximum ${max}`, expected: `maximum ${max}`, value: val });
              return;
            }
            out[name] = val;
            return;
          }
          case 'boolean': {
            if (typeof val !== 'boolean') {
              issues.push({ path, message: `expected ${expectedType}`, expected: expectedType, value: val });
              return;
            }
            out[name] = val;
            return;
          }
          case 'timestamp': {
            if (!(val instanceof Date)) {
              issues.push({ path, message: `expected ${expectedType}`, expected: expectedType, value: val });
              return;
            }
            out[name] = val;
            return;
          }
          case 'json': {
            if (typeof val !== 'object' || val === null) {
              issues.push({ path, message: `expected ${expectedType}`, expected: expectedType, value: val });
              return;
            }
            out[name] = val;
            return;
          }
          default: {
            out[name] = val;
            return;
          }
        }
      });
    }

    return composeFieldCheckers(checkers);
  }

  const runCreateCheckers = buildCheckers(createShape);
  const runUpdateCheckers = buildCheckers(updateShape);

  const rawColumns = schema.columns || {};

  function checkExcess(obj: Record<string, unknown>, accepted: ReadonlySet<string>, issues: ValidationIssue[]): void {
    for (const key in obj) {
      if (obj[key] === undefined) continue;
      if (accepted.has(key)) continue;
      const col = Object.hasOwn(rawColumns, key) ? rawColumns[key] : undefined;
      const message = !col
        ? `"${key}" is not a column of "${schema.table}"`
        : col.flags?.autoIncrement
          ? `the database generates "${key}", so a payload cannot supply it`
          : `"${key}" identifies the row and cannot be patched`;
      issues.push({ path: `input.${key}`, message, expected: 'no excess properties', value: obj[key] });
    }
  }

  function validateCreate(payload: unknown): Record<string, unknown> {
    if (!isRecord(payload)) {
      throw new ValidationError('payload must be an object', [
        { path: 'input', message: 'expected object', expected: 'object', value: payload },
      ]);
    }
    const obj = payload;
    const issues: ValidationIssue[] = [];
    const out: Record<string, unknown> = {};

    runCreateCheckers(obj, out, issues);
    checkExcess(obj, acceptedCreate, issues);

    if (issues.length > 0) {
      throw new ValidationError(`validation failed: ${issues.map(i => i.path).join(', ')}`, issues);
    }
    return out;
  }

  function validateUpdate(payload: unknown): Record<string, unknown> {
    if (!isRecord(payload)) {
      throw new ValidationError('payload must be an object', [
        { path: 'input', message: 'expected object', expected: 'object', value: payload },
      ]);
    }
    const obj = payload;
    const issues: ValidationIssue[] = [];
    const out: Record<string, unknown> = {};

    runUpdateCheckers(obj, out, issues);
    checkExcess(obj, acceptedUpdate, issues);

    if (issues.length > 0) {
      throw new ValidationError(`validation failed: ${issues.map(i => i.path).join(', ')}`, issues);
    }
    return out;
  }

  return { validateCreate, validateUpdate };
}
