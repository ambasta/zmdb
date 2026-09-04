import { compileOpenApiTools, type CompiledOpenApiTool } from './parse.js';
import type { OpenApiToolsOptions } from './types.js';

type ConstraintTag = 'Max' | 'MaxLength' | 'Min' | 'MinLength' | 'Pattern';

interface RenderContext {
  readonly tags: Set<ConstraintTag>;
  readonly path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringLiteral(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n').replaceAll('\r', '\\r')}'`;
}

function literal(value: unknown): string {
  if (typeof value === 'string') return stringLiteral(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  throw new TypeError(`OpenAPI enum contains an unsupported literal at generation: ${String(value)}`);
}

function tag(context: RenderContext, name: ConstraintTag, value: unknown): string | undefined {
  if (typeof value !== (name === 'Pattern' ? 'string' : 'number')) return undefined;
  context.tags.add(name);
  return `${name}<${literal(value)}>`;
}

function constrained(base: string, schema: Record<string, unknown>, context: RenderContext): string {
  const tags = [
    tag(context, 'Min', schema['minimum']),
    tag(context, 'Max', schema['maximum']),
    tag(context, 'MinLength', schema['minLength']),
    tag(context, 'MaxLength', schema['maxLength']),
    tag(context, 'Pattern', schema['pattern']),
  ].filter(value => value !== undefined);
  return tags.length === 0 ? base : `${base} & ${tags.join(' & ')}`;
}

function propertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : stringLiteral(name);
}

function requiredNames(schema: Record<string, unknown>): ReadonlySet<string> {
  const value = schema['required'];
  return new Set(Array.isArray(value) ? value.filter(name => typeof name === 'string') : []);
}

function objectType(schema: Record<string, unknown>, context: RenderContext): string {
  const properties = schema['properties'];
  if (!isRecord(properties)) return 'Readonly<Record<never, never>>';
  const required = requiredNames(schema);
  const lines = Object.keys(properties)
    .toSorted()
    .map(name => {
      const child = properties[name];
      if (!isRecord(child)) throw new TypeError(`OpenAPI property ${context.path}.${name} is not a schema`);
      const optional = required.has(name) ? '' : '?';
      return `  readonly ${propertyName(name)}${optional}: ${schemaType(child, { ...context, path: `${context.path}.${name}` })};`;
    });
  return lines.length === 0 ? 'Readonly<Record<never, never>>' : `{\n${lines.join('\n')}\n}`;
}

function union(schema: Record<string, unknown>, key: 'anyOf' | 'oneOf', context: RenderContext): string | undefined {
  const value = schema[key];
  if (!Array.isArray(value)) return undefined;
  return value
    .map((member, index) => {
      if (!isRecord(member)) throw new TypeError(`OpenAPI ${key} member ${index} at ${context.path} is not a schema`);
      return schemaType(member, { ...context, path: `${context.path}.${key}[${index}]` });
    })
    .join(' | ');
}

function schemaType(schema: Record<string, unknown>, context: RenderContext): string {
  const oneOf = union(schema, 'oneOf', context);
  if (oneOf !== undefined) return oneOf;
  const anyOf = union(schema, 'anyOf', context);
  if (anyOf !== undefined) return anyOf;

  const values = schema['enum'];
  if (Array.isArray(values) && values.length > 0) return values.map(literal).join(' | ');

  const type = schema['type'];
  if (Array.isArray(type)) {
    return type
      .map(member => schemaType({ ...schema, type: member }, context))
      .filter((member, index, all) => all.indexOf(member) === index)
      .join(' | ');
  }

  let result: string;
  switch (type) {
    case 'string':
      result = constrained('string', schema, context);
      break;
    case 'integer':
    case 'number':
      result = constrained('number', schema, context);
      break;
    case 'boolean':
      result = 'boolean';
      break;
    case 'null':
      result = 'null';
      break;
    case 'array': {
      const items = schema['items'];
      if (!isRecord(items)) throw new TypeError(`OpenAPI array ${context.path} has no item schema`);
      result = `readonly (${schemaType(items, { ...context, path: `${context.path}[]` })})[]`;
      break;
    }
    case 'object':
      result = objectType(schema, context);
      break;
    default:
      result = isRecord(schema['properties']) ? objectType(schema, context) : 'unknown';
  }
  return schema['nullable'] === true && result !== 'null' ? `${result} | null` : result;
}

function typeName(operationId: string, used: Set<string>): string {
  const words = operationId.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const base = `${words.map(word => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join('') || 'Tool'}Arguments`;
  let candidate = /^[A-Za-z_$]/.test(base) ? base : `Tool${base}`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function variableName(type: string): string {
  return `${type[0]?.toLowerCase() ?? 't'}${type.slice(1).replace(/Arguments$/, 'Tool')}`;
}

function renderValue(value: unknown, depth = 0): string {
  if (typeof value === 'string') return stringLiteral(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      return `[${value.map(item => renderValue(item, depth + 1)).join(', ')}]`;
    }
    const indent = '  '.repeat(depth + 1);
    return `[\n${value.map(item => `${indent}${renderValue(item, depth + 1)},`).join('\n')}\n${'  '.repeat(depth)}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const indent = '  '.repeat(depth + 1);
    return `{\n${entries
      .map(([key, item]) => `${indent}${propertyName(key)}: ${renderValue(item, depth + 1)},`)
      .join('\n')}\n${'  '.repeat(depth)}}`;
  }
  throw new TypeError(`cannot render generated OpenAPI value: ${String(value)}`);
}

function renderTool(tool: CompiledOpenApiTool, type: string, variable: string, tags: Set<ConstraintTag>): string {
  const context: RenderContext = { tags, path: tool.spec.name };
  const schema = {
    type: 'object',
    properties: tool.argumentSchemas,
    required: tool.required,
  };
  const args = schemaType(schema, context);
  const validationType = Object.keys(tool.argumentSchemas).length === 0 ? 'OpenApiNoArguments' : type;
  return `export type ${type} = ${args};

export const ${variable}: OpenApiGeneratedTool<${type}> = {
  spec: ${renderValue(tool.spec, 1)},
  request: ${renderValue(tool.request, 1)},
  validate: (input: unknown): ${type} => assert<${validationType}>(input),
};`;
}

/**
 * Render a checked-in TypeScript module. The generated `assert<T>` calls are
 * deliberately left for `@zmdb/aot-validator`'s existing build transform.
 */
export function generateOpenApiToolsModule(document: unknown, options: OpenApiToolsOptions = {}): string {
  const tools = compileOpenApiTools(document, options);
  const tags = new Set<ConstraintTag>();
  const names = new Set<string>();
  const rendered = tools.map(tool => {
    const type = typeName(tool.spec.name, names);
    return { tool, type, variable: variableName(type) };
  });
  const bodies = rendered.map(entry => renderTool(entry.tool, entry.type, entry.variable, tags));
  const emptyArgumentsType = rendered.some(entry => Object.keys(entry.tool.argumentSchemas).length === 0)
    ? `type OpenApiNoArguments = {
  readonly __openApiNoArguments?: string;
};

`
    : '';
  const tagImport =
    tags.size === 0 ? '' : `import type { ${[...tags].toSorted().join(', ')} } from '@zmdb/schema-core/tags';\n`;
  const registry =
    rendered.length === 0
      ? 'export const openApiTools = {};\n'
      : `export const openApiTools = {\n${rendered
          .map(entry => `  ${propertyName(entry.tool.spec.name)}: ${entry.variable},`)
          .join('\n')}\n};\n`;

  return `// generated by @zmdb/schema-core/llm/http — do not edit
import { assert } from '@zmdb/aot-validator/utilities';
import type { OpenApiGeneratedTool } from '@zmdb/schema-core/llm/http';
${tagImport}
${emptyArgumentsType}${bodies.join('\n\n')}

${registry}`;
}
