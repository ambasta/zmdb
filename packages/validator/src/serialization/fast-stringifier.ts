// Fast schema-aware stringifier compiler for @zmdb/aot-validator.
import { stringify } from './index.ts';

/**
 * Extracts column/field definitions from various schema representations
 * (CoreSchema, TypeDescriptor, plain object maps, etc.).
 */
function extractColumns(schema: unknown): Record<string, unknown> | undefined {
  if (schema === null || typeof schema !== 'object') {
    return undefined;
  }

  // CoreSchema object with `.columns`
  if ('columns' in schema && schema.columns !== null && typeof schema.columns === 'object') {
    return schema.columns as Record<string, unknown>;
  }

  // TypeDescriptor object with `.fields`
  if ('fields' in schema && schema.fields !== null && typeof schema.fields === 'object') {
    return schema.fields as Record<string, unknown>;
  }

  // Direct column map or record
  return schema as Record<string, unknown>;
}

/** Checks if a column/field definition is marked as sensitive. */
function isSensitive(colDef: unknown): boolean {
  if (colDef === null || typeof colDef !== 'object') {
    return false;
  }
  const colObj = colDef as Record<string, unknown>;
  if (colObj.sensitive === true) {
    return true;
  }
  if (colObj.flags !== null && typeof colObj.flags === 'object') {
    const flags = colObj.flags as Record<string, unknown>;
    if (flags.sensitive === true) {
      return true;
    }
  }
  return false;
}

/** Fast stringify helper for individual values. */
function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'bigint') throw new TypeError('Do not know how to serialize a BigInt');
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  return JSON.stringify(v);
}

/**
 * Compiles a fast stringifier function for a schema.
 * Automatically excludes fields marked as sensitive.
 * Falls back safely to standard runtime serialization primitives on compilation/execution errors.
 */
export function compileFastStringifier(schema: unknown): (value: unknown) => string {
  try {
    const columns = extractColumns(schema);
    if (!columns || Object.keys(columns).length === 0) {
      return (value: unknown) => stringify(value);
    }

    const nonSensitiveKeys: string[] = [];
    for (const [key, colDef] of Object.entries(columns)) {
      if (!isSensitive(colDef)) {
        nonSensitiveKeys.push(key);
      }
    }

    // Single-entity fast stringifier
    const serializeEntity = (obj: Record<string, unknown>): string => {
      let out = '{';
      let first = true;
      for (let i = 0; i < nonSensitiveKeys.length; i++) {
        const key = nonSensitiveKeys[i];
        if (key === undefined) {
          continue;
        }
        const val = obj[key];
        if (val === undefined) {
          continue;
        }
        if (!first) {
          out += ',';
        }
        out += JSON.stringify(key) + ':' + formatValue(val);
        first = false;
      }
      out += '}';
      return out;
    };

    return function fastStringifier(value: unknown): string {
      try {
        if (typeof value === 'string') {
          return value;
        }
        if (value === null || value === undefined) {
          return 'null';
        }
        if (typeof value !== 'object') {
          return String(value);
        }
        if (Array.isArray(value)) {
          let out = '[';
          for (let i = 0; i < value.length; i++) {
            if (i > 0) out += ',';
            const item = value[i];
            if (item !== null && typeof item === 'object' && !('error' in item) && !('issues' in item)) {
              out += serializeEntity(item as Record<string, unknown>);
            } else {
              out += stringify(item);
            }
          }
          out += ']';
          return out;
        }

        // Check if value is an error or issues response object
        const record = value as Record<string, unknown>;
        if ('error' in record || 'issues' in record) {
          return stringify(value);
        }

        return serializeEntity(record);
      } catch (_err) {
        return stringify(value);
      }
    };
  } catch (_compileErr) {
    return (value: unknown) => stringify(value);
  }
}

/** Alias for compileFastStringifier. */
export const compileStringifier = compileFastStringifier;
