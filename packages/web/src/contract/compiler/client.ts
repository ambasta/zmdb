// Deterministic HttpContractIR -> typed @zmdb/client module emission.
//
// This is build-time code. The generated module contains only precomputed request
// plans, response dispatch and AOT validation helpers, and imports its runtime ABI
// exclusively from @zmdb/client.

import { Emitter } from '@zmdb/aot-validator/emit';

import type {
  HttpBodyIR,
  HttpContractIR,
  HttpOperationIR,
  HttpParameterIR,
  HttpResponseIR,
  HttpTypeIR,
  SecurityScheme,
} from '../index.js';

export const HTTP_CLIENT_GENERATOR_VERSION = '1.0.0';

type TypeIR = HttpTypeIR['type'];
type ObjectIR = Extract<TypeIR, { readonly kind: 'object' }>;

export interface GeneratedHttpClientModule {
  readonly source: string;
  readonly sourceMap: string;
  readonly operations: readonly string[];
  readonly contractFormat: 1;
  readonly generatorVersion: string;
}

interface BodyModel {
  readonly body: HttpBodyIR;
  readonly type: string;
  readonly validator?: string;
}

interface ResponseModel {
  readonly response: HttpResponseIR;
  readonly headersType: string;
  readonly headersDecoder?: string;
  readonly bodies: ReadonlyMap<string, BodyModel>;
}

interface OperationModel {
  readonly operation: HttpOperationIR;
  readonly stem: string;
  readonly inputType: string;
  readonly resultType: string;
  readonly resultTypesByVersion: ReadonlyMap<string, string>;
  readonly callOptionsType: string;
  readonly responses: readonly ResponseModel[];
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const JSON_BODY_KIND: HttpBodyIR['kind'] = 'json';
const TEXT_BODY_KIND: HttpBodyIR['kind'] = 'text';
const RESERVED_IDENTIFIERS = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

function generationError(field: string, problem: string): Error {
  return new Error(`HTTP client generator at ${field}: ${problem}`);
}

function isJsonBody(body: HttpBodyIR): body is Extract<HttpBodyIR, { readonly kind: 'json' }> {
  return body.kind === JSON_BODY_KIND;
}

function isTextBody(body: HttpBodyIR): body is { readonly kind: 'text'; readonly mediaType: string } {
  return body.kind === TEXT_BODY_KIND;
}

function operationError(operationId: string, field: string, problem: string): Error {
  return generationError(`${operationId}.${field}`, problem);
}

function literal(value: string | number | boolean): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw generationError('type', 'non-finite number literals have no stable TypeScript spelling');
  }
  const printed = JSON.stringify(value);
  if (printed === undefined) throw generationError('type', 'could not print a literal');
  return printed;
}

function propertyName(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

function propertyAccess(target: string, name: string, optional: boolean): string {
  if (IDENTIFIER.test(name)) return `${target}${optional ? '?.' : '.'}${name}`;
  return `${target}${optional ? '?.' : ''}[${JSON.stringify(name)}]`;
}

function typeToken(value: string): string {
  const words = value.split(/[^A-Za-z0-9$]+/u).filter(word => word.length > 0);
  const token = words.map(word => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join('');
  return token.length === 0 ? 'Value' : /^[A-Za-z_$]/u.test(token) ? token : `Value${token}`;
}

function operationStem(operationId: string): string {
  return typeToken(operationId);
}

function stableJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  switch (typeof value) {
    case 'boolean':
    case 'string': {
      const printed = JSON.stringify(value);
      if (printed === undefined) throw generationError('contract', 'contains an unprintable scalar');
      return printed;
    }
    case 'number': {
      if (!Number.isFinite(value)) throw generationError('contract', 'contains a non-finite number');
      return JSON.stringify(value);
    }
    case 'object': {
      const fields = Object.keys(value)
        .toSorted()
        .flatMap(key => {
          const nested = Reflect.get(value, key);
          return nested === undefined ? [] : [`${JSON.stringify(key)}:${stableJson(nested)}`];
        });
      return `{${fields.join(',')}}`;
    }
    default:
      throw generationError('contract', `contains non-JSON ${typeof value}`);
  }
}

function typeScriptPrelude(source: string): string {
  return source.replace(
    /function ([A-Za-z_$][A-Za-z0-9_$]*)\(([^)]*)\)/gu,
    (_match: string, name: string, parameters: string) => {
      const typed = parameters
        .split(',')
        .map(parameter => parameter.trim())
        .filter(parameter => parameter.length > 0)
        .map(parameter => `${parameter}: any`)
        .join(', ');
      return `function ${name}(${typed})`;
    },
  );
}

function typeScriptValidationExpression(source: string): string {
  const wrappedArrow = '((() => {';
  const arrow = '(() => {';
  const returnType =
    '{ readonly success: true; readonly data: unknown } | ' +
    '{ readonly success: false; readonly errors: readonly ValidationIssue[] }';
  if (!source.startsWith(wrappedArrow) && !source.startsWith(arrow)) {
    throw generationError('validator', 'AOT emitter returned an unknown expression shape');
  }
  return source
    .replace(
      source.startsWith(wrappedArrow) ? wrappedArrow : arrow,
      source.startsWith(wrappedArrow) ? `(((): ${returnType} => {` : `((): ${returnType} => {`,
    )
    .replaceAll('const _e = [];', 'const _e: ValidationIssue[] = [];');
}

function collectDefinitions(node: TypeIR, definitions: Map<string, ObjectIR>, seen: Set<TypeIR>): void {
  if (seen.has(node)) return;
  seen.add(node);
  switch (node.kind) {
    case 'array':
      collectDefinitions(node.element, definitions, seen);
      return;
    case 'tuple':
      for (const element of node.elements) collectDefinitions(element, definitions, seen);
      return;
    case 'union':
      for (const member of node.members) collectDefinitions(member, definitions, seen);
      return;
    case 'object': {
      if (node.name !== undefined) {
        const present = definitions.get(node.name);
        if (present !== undefined && stableJson(present) !== stableJson(node)) {
          throw generationError('type', `named object ${node.name} has two different definitions`);
        }
        definitions.set(node.name, node);
      }
      for (const property of node.properties) collectDefinitions(property.type, definitions, seen);
      return;
    }
    default:
      return;
  }
}

class TypePrinter {
  readonly #rootName: string;
  readonly #definitions = new Map<string, ObjectIR>();
  readonly #helpers = new Map<string, string>();

  constructor(rootName: string, node: TypeIR, uniqueName: (base: string) => string) {
    this.#rootName = rootName;
    collectDefinitions(node, this.#definitions, new Set());
    for (const name of this.#definitions.keys()) {
      const base = `${rootName}${typeToken(name)}`;
      this.#helpers.set(name, uniqueName(base));
    }
  }

  declarations(): readonly string[] {
    const declarations: string[] = [];
    for (const [name, node] of this.#definitions) {
      const helper = this.#helpers.get(name);
      if (helper === undefined) throw generationError(this.#rootName, `missing helper for ${name}`);
      declarations.push(`type ${helper} = ${this.#object(node)};`);
    }
    return declarations;
  }

  print(node: TypeIR): string {
    switch (node.kind) {
      case 'scalar':
        switch (node.scalar) {
          case 'string':
            return 'string';
          case 'number':
          case 'integer':
            return 'number';
          case 'bigint':
            return 'bigint';
          case 'boolean':
            return 'boolean';
          case 'date':
            return 'Date';
        }
      case 'literal':
        return literal(node.value);
      case 'null':
        return 'null';
      case 'undefined':
        return 'undefined';
      case 'array':
        return `readonly (${this.print(node.element)})[]`;
      case 'tuple':
        return `readonly [${node.elements.map(element => this.print(element)).join(', ')}]`;
      case 'union':
        if (node.members.length === 0) throw generationError(this.#rootName, 'an empty union matches nothing');
        return node.members.map(member => this.print(member)).join(' | ');
      case 'object':
        if (node.name === undefined) return this.#object(node);
        return this.#named(node.name);
      case 'ref':
        return this.#named(node.name);
      case 'unknown':
        throw generationError(this.#rootName, 'unknown cannot produce an exact generated signature');
      case 'unsupported':
        throw generationError(this.#rootName, `${node.reason}${node.source === undefined ? '' : ` (${node.source})`}`);
    }
  }

  #named(name: string): string {
    const helper = this.#helpers.get(name);
    if (helper === undefined) throw generationError(this.#rootName, `back-reference ${name} has no definition`);
    return helper;
  }

  #object(node: ObjectIR): string {
    if (node.properties.length === 0) return 'Readonly<Record<string, unknown>>';
    const properties = node.properties.map(property => {
      const modifier = property.readonly ? 'readonly ' : '';
      const optional = property.optional ? '?' : '';
      return `${modifier}${propertyName(property.name)}${optional}: ${this.print(property.type)};`;
    });
    return `{ ${properties.join(' ')} }`;
  }
}

function definitionsOf(node: TypeIR): ReadonlyMap<string, ObjectIR> {
  const definitions = new Map<string, ObjectIR>();
  collectDefinitions(node, definitions, new Set());
  return definitions;
}

function resolveObject(node: TypeIR, definitions: ReadonlyMap<string, ObjectIR>): ObjectIR | undefined {
  if (node.kind === 'object') return node;
  if (node.kind === 'ref') return definitions.get(node.name);
  return undefined;
}

function containsDate(
  node: TypeIR,
  definitions: ReadonlyMap<string, ObjectIR>,
  visiting: ReadonlySet<string> = new Set(),
): boolean {
  switch (node.kind) {
    case 'scalar':
      return node.scalar === 'date';
    case 'array':
      return containsDate(node.element, definitions, visiting);
    case 'tuple':
      return node.elements.some(element => containsDate(element, definitions, visiting));
    case 'union':
      return node.members.some(member => containsDate(member, definitions, visiting));
    case 'object': {
      if (node.name !== undefined && visiting.has(node.name)) return false;
      const nested = new Set(visiting);
      if (node.name !== undefined) nested.add(node.name);
      return node.properties.some(property => containsDate(property.type, definitions, nested));
    }
    case 'ref': {
      if (visiting.has(node.name)) return false;
      const target = definitions.get(node.name);
      if (target === undefined) throw generationError('type', `back-reference ${node.name} has no definition`);
      return containsDate(target, definitions, new Set([...visiting, node.name]));
    }
    default:
      return false;
  }
}

function literalDiscriminant(
  members: readonly TypeIR[],
  definitions: ReadonlyMap<string, ObjectIR>,
): { readonly property: string; readonly values: readonly (string | number | boolean)[] } | undefined {
  const objects = members.map(member => resolveObject(member, definitions));
  if (objects.some(object => object === undefined)) return undefined;
  const first = objects[0];
  if (first === undefined) return undefined;
  for (const candidate of first.properties) {
    if (candidate.type.kind !== 'literal') continue;
    const values: (string | number | boolean)[] = [candidate.type.value];
    let complete = true;
    for (const object of objects.slice(1)) {
      const property = object?.properties.find(entry => entry.name === candidate.name);
      if (property?.type.kind !== 'literal' || values.includes(property.type.value)) {
        complete = false;
        break;
      }
      values.push(property.type.value);
    }
    if (complete) return { property: candidate.name, values };
  }
  return undefined;
}

class DecoderPrinter {
  readonly #prefix: string;
  readonly #definitions: ReadonlyMap<string, ObjectIR>;
  readonly #helpers: string[] = [];
  readonly #objectHelpers = new Map<ObjectIR, string>();
  readonly #arrayHelpers = new Map<TypeIR, string>();
  #counter = 0;
  #dateHelper: string | undefined;

  constructor(prefix: string, node: TypeIR) {
    this.#prefix = prefix;
    this.#definitions = definitionsOf(node);
  }

  declarations(): readonly string[] {
    return this.#helpers;
  }

  decode(node: TypeIR, value: string): string {
    if (!containsDate(node, this.#definitions)) return value;
    switch (node.kind) {
      case 'scalar':
        return `${this.#date()}(${value})`;
      case 'array':
        return `${this.#array(node)}(${value})`;
      case 'tuple':
        return `${this.#tuple(node)}(${value})`;
      case 'object':
        return `${this.#object(node)}(${value})`;
      case 'ref': {
        const target = this.#definitions.get(node.name);
        if (target === undefined) throw generationError(this.#prefix, `back-reference ${node.name} has no definition`);
        return `${this.#object(target)}(${value})`;
      }
      case 'union':
        return this.#union(node, value);
      default:
        return value;
    }
  }

  #name(hint: string): string {
    const name = `${this.#prefix}${hint}${String(this.#counter)}`;
    this.#counter += 1;
    return name;
  }

  #date(): string {
    if (this.#dateHelper !== undefined) return this.#dateHelper;
    const name = this.#name('Date');
    this.#dateHelper = name;
    this.#helpers.push(
      `function ${name}(value: unknown): unknown { return typeof value === 'string' ? new Date(value) : value; }`,
    );
    return name;
  }

  #object(node: ObjectIR): string {
    const present = this.#objectHelpers.get(node);
    if (present !== undefined) return present;
    const name = this.#name('Object');
    this.#objectHelpers.set(node, name);
    const properties = node.properties.flatMap(property => {
      if (!containsDate(property.type, this.#definitions)) return [];
      const access = `Reflect.get(value, ${JSON.stringify(property.name)})`;
      const decoded = this.decode(property.type, access);
      const field = `${propertyName(property.name)}: ${decoded}`;
      return property.optional
        ? [`...(Object.hasOwn(value, ${JSON.stringify(property.name)}) ? { ${field} } : {})`]
        : [field];
    });
    const body = properties.length === 0 ? 'return value;' : `return { ...value, ${properties.join(', ')} };`;
    this.#helpers.push(
      `function ${name}(value: unknown): unknown { ` +
        `if (typeof value !== 'object' || value === null || Array.isArray(value)) return value; ${body} }`,
    );
    return name;
  }

  #array(node: Extract<TypeIR, { readonly kind: 'array' }>): string {
    const present = this.#arrayHelpers.get(node);
    if (present !== undefined) return present;
    const name = this.#name('Array');
    this.#arrayHelpers.set(node, name);
    const decoded = this.decode(node.element, 'value[index]');
    this.#helpers.push(
      `function ${name}(value: unknown): unknown { if (!Array.isArray(value)) return value; ` +
        `const output: unknown[] = []; for (let index = 0; index < value.length; index += 1) ` +
        `output.push(${decoded}); return output; }`,
    );
    return name;
  }

  #tuple(node: Extract<TypeIR, { readonly kind: 'tuple' }>): string {
    const present = this.#arrayHelpers.get(node);
    if (present !== undefined) return present;
    const name = this.#name('Tuple');
    this.#arrayHelpers.set(node, name);
    const values = node.elements.map((element, index) => this.decode(element, `value[${String(index)}]`));
    this.#helpers.push(
      `function ${name}(value: unknown): unknown { if (!Array.isArray(value)) return value; ` +
        `return [${values.join(', ')}]; }`,
    );
    return name;
  }

  #union(node: Extract<TypeIR, { readonly kind: 'union' }>, value: string): string {
    const transformed = node.members.filter(member => containsDate(member, this.#definitions));
    const inert = node.members.filter(member => !containsDate(member, this.#definitions));
    if (transformed.length === 1 && inert.every(member => member.kind === 'null' || member.kind === 'undefined')) {
      const decoded = this.decode(transformed[0] ?? { kind: 'unknown' }, value);
      return `${value} === null || ${value} === undefined ? ${value} : ${decoded}`;
    }

    const discriminant = literalDiscriminant(node.members, this.#definitions);
    if (discriminant === undefined) {
      throw generationError(
        this.#prefix,
        'a date-bearing union has no literal object discriminant or nullable single transformed arm',
      );
    }
    const helper = this.#name('Union');
    const branches = node.members.map((member, index) => {
      const decoded = this.decode(member, 'value');
      const discriminator = discriminant.values[index];
      if (discriminator === undefined) {
        throw generationError(this.#prefix, 'a discriminated union lost one discriminator');
      }
      return (
        `if (Reflect.get(value, ${JSON.stringify(discriminant.property)}) === ${literal(discriminator)}) ` +
        `return ${decoded};`
      );
    });
    this.#helpers.push(
      `function ${helper}(value: unknown): unknown { ` +
        `if (typeof value !== 'object' || value === null || Array.isArray(value)) return value; ` +
        `${branches.join(' ')} return value; }`,
    );
    return `${helper}(${value})`;
  }
}

function assertJsonType(
  node: TypeIR,
  field: string,
  definitions: ReadonlyMap<string, ObjectIR>,
  visiting: ReadonlySet<string> = new Set(),
): void {
  switch (node.kind) {
    case 'unsupported':
      throw generationError(field, node.reason);
    case 'unknown':
      throw generationError(field, 'unknown cannot produce an exact JSON validator');
    case 'undefined':
      throw generationError(field, 'undefined has no JSON wire representation');
    case 'scalar':
      if (node.scalar === 'bigint') throw generationError(field, 'bigint has no JSON wire representation');
      return;
    case 'array':
      assertJsonType(node.element, `${field}[]`, definitions, visiting);
      return;
    case 'tuple':
      for (const [index, element] of node.elements.entries()) {
        assertJsonType(element, `${field}[${String(index)}]`, definitions, visiting);
      }
      return;
    case 'union':
      for (const member of node.members) assertJsonType(member, field, definitions, visiting);
      return;
    case 'object': {
      if (node.name !== undefined && visiting.has(node.name)) return;
      const nested = new Set(visiting);
      if (node.name !== undefined) nested.add(node.name);
      for (const property of node.properties) {
        assertJsonType(property.type, `${field}.${property.name}`, definitions, nested);
      }
      return;
    }
    case 'ref': {
      if (visiting.has(node.name)) return;
      const target = definitions.get(node.name);
      if (target === undefined) throw generationError(field, `back-reference ${node.name} has no definition`);
      assertJsonType(target, field, definitions, new Set([...visiting, node.name]));
      return;
    }
    default:
      return;
  }
}

type ScalarCategory = 'string' | 'number' | 'bigint' | 'boolean' | 'date';

function scalarCategory(node: TypeIR, field: string): ScalarCategory {
  if (node.kind === 'scalar') {
    return node.scalar === 'integer' ? 'number' : node.scalar;
  }
  if (node.kind === 'literal') {
    if (typeof node.value === 'string') return 'string';
    if (typeof node.value === 'number') return 'number';
    return 'boolean';
  }
  if (node.kind === 'union' && node.members.length > 0) {
    const categories = new Set(node.members.map(member => scalarCategory(member, field)));
    if (categories.size === 1) {
      const category = categories.values().next().value;
      if (category !== undefined) return category;
    }
    if (categories.size === 2 && categories.has('string') && categories.has('date')) return 'string';
  }
  throw generationError(field, `${node.kind} has incompatible HTTP scalar spellings`);
}

function versionKeys(operation: HttpOperationIR): readonly string[] {
  return operation.version.kind === 'media-type' ? operation.version.values : [''];
}

function bodyForVersion(operation: HttpOperationIR, response: HttpResponseIR, version: string): HttpBodyIR {
  if (version.length === 0 || response.versions === undefined) return response.body;
  const body = response.versions[version];
  if (body === undefined) {
    throw operationError(
      operation.operationId,
      `responses.${String(response.status)}.versions`,
      `does not declare version ${version}`,
    );
  }
  return body;
}

function mediaParameterValue(value: string): string {
  return HTTP_TOKEN.test(value) ? value : `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function versionedMediaType(operation: HttpOperationIR, body: HttpBodyIR, version: string): string {
  if (body.kind === 'empty') {
    throw operationError(operation.operationId, 'responses', 'an empty body has no media type');
  }
  if (operation.version.kind !== 'media-type') return body.mediaType;
  return `${body.mediaType}; ${operation.version.key.toLowerCase()}=${mediaParameterValue(version)}`;
}

function bodyType(body: HttpBodyIR, jsonType: string | undefined): string {
  if (isJsonBody(body)) {
    if (jsonType === undefined) throw generationError('body', `missing type ${body.typeId}`);
    return jsonType;
  }
  if (isTextBody(body)) return 'string';
  if (body.kind === 'bytes') return 'Uint8Array<ArrayBuffer>';
  if (body.kind === 'stream') return 'ReadableStream<Uint8Array<ArrayBuffer>>';
  return 'void';
}

function clientSecurityScheme(scheme: SecurityScheme): Readonly<Record<string, string>> {
  switch (scheme.type) {
    case 'http':
      return { type: scheme.type, scheme: scheme.scheme };
    case 'apiKey':
      return { type: scheme.type, in: scheme.in, name: scheme.name };
    case 'mutualTLS':
    case 'oauth2':
    case 'openIdConnect':
      return { type: scheme.type };
  }
}

function sourceBody(body: HttpBodyIR): Readonly<Record<string, unknown>> {
  if (isJsonBody(body)) {
    return { kind: body.kind, mediaType: body.mediaType, typeId: body.typeId };
  }
  if (body.kind === 'empty') return { kind: body.kind };
  return { kind: body.kind, mediaType: body.mediaType };
}

function sourceOperation(operation: HttpOperationIR): Readonly<Record<string, unknown>> {
  return {
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    parameters: operation.parameters.map(parameter => ({
      property: parameter.property,
      name: parameter.name,
      in: parameter.in,
      required: parameter.required,
      typeId: parameter.typeId,
    })),
    ...(operation.requestBody === undefined
      ? {}
      : {
          requestBody: {
            ...sourceBody(operation.requestBody),
            required: operation.requestBody.required,
          },
        }),
    responses: operation.responses.map(response => ({
      status: response.status,
      headers: response.headers.map(header => ({
        property: header.property,
        name: header.name,
        required: header.required,
        typeId: header.typeId,
      })),
      body: sourceBody(response.body),
      ...(response.versions === undefined
        ? {}
        : {
            versions: Object.fromEntries(
              Object.keys(response.versions)
                .toSorted()
                .flatMap(version => {
                  const body = response.versions?.[version];
                  return body === undefined ? [] : [[version, sourceBody(body)]];
                }),
            ),
          }),
    })),
    security: operation.security,
    version: operation.version,
    deprecated: operation.deprecated,
  };
}

function sourceContract(contract: HttpContractIR, typeIds: ReadonlySet<string>): Readonly<Record<string, unknown>> {
  const types: Record<string, TypeIR> = {};
  for (const typeId of [...typeIds].toSorted()) {
    const type = contract.types[typeId];
    if (type !== undefined) types[typeId] = type.type;
  }
  const schemeNames = new Set(
    contract.operations.flatMap(operation => operation.security.flatMap(requirement => Object.keys(requirement))),
  );
  const schemes: Record<string, Readonly<Record<string, string>>> = {};
  for (const name of [...schemeNames].toSorted()) {
    const scheme = contract.securitySchemes[name];
    if (scheme !== undefined) schemes[name] = clientSecurityScheme(scheme);
  }
  return {
    format: 1,
    types,
    operations: [...contract.operations]
      .toSorted((left, right) => left.operationId.localeCompare(right.operationId))
      .map(sourceOperation),
    securitySchemes: schemes,
  };
}

class ModuleGenerator {
  readonly #contract: HttpContractIR;
  readonly #emitter = new Emitter({ prefix: '_zmdbClient' });
  readonly #declarations: string[] = [];
  readonly #validators: string[] = [];
  readonly #moduleHelpers = new Map<string, string>();
  readonly #typeNames = new Map<string, string>();
  readonly #usedNames = new Set<string>();
  readonly #usedStems = new Set<string>();

  constructor(contract: HttpContractIR) {
    this.#contract = contract;
  }

  generate(): GeneratedHttpClientModule {
    this.#assertContract();
    const operations = [...this.#contract.operations].toSorted((left, right) =>
      left.operationId.localeCompare(right.operationId),
    );
    const seen = new Set<string>();
    const models: OperationModel[] = [];
    for (const operation of operations) {
      if (seen.has(operation.operationId)) {
        throw operationError(operation.operationId, 'operationId', 'appears more than once');
      }
      seen.add(operation.operationId);
      models.push(this.#operationModel(operation));
    }

    const operationBlocks = models.map(model => this.#operationBlock(model));
    const api = this.#apiInterface(models);
    const factory = this.#factory(models);
    const prelude = this.#emitter.hasPrelude ? typeScriptPrelude(this.#emitter.prelude()) : '';
    const sections = [
      `// @generated by zmdb http-client; contract-format=1; generator=${HTTP_CLIENT_GENERATOR_VERSION}`,
      `import { ClientRequestError, ClientResponseError, ResponseValidationError, createClientRuntime, prepareClientBody, stringifyClientScalar, substituteClientPath } from '@zmdb/client';`,
      `import type { CallOptions, ClientHeaders, ClientOptions, DecodeResult, GeneratedOperation, ValidationIssue } from '@zmdb/client';`,
      prelude,
      [...this.#moduleHelpers.values()].join('\n'),
      this.#declarations.join('\n\n'),
      this.#validators.join('\n\n'),
      operationBlocks.join('\n\n'),
      api,
      factory,
    ].filter(section => section.length > 0);
    const source = `${sections.join('\n\n')}\n`;
    const sourceMap = this.#sourceMap(source);
    return Object.freeze({
      source,
      sourceMap,
      operations: Object.freeze(models.map(model => model.operation.operationId)),
      contractFormat: 1,
      generatorVersion: HTTP_CLIENT_GENERATOR_VERSION,
    });
  }

  #assertContract(): void {
    if (
      this.#contract === null ||
      typeof this.#contract !== 'object' ||
      this.#contract.format !== 1 ||
      !Array.isArray(this.#contract.operations) ||
      this.#contract.types === null ||
      typeof this.#contract.types !== 'object' ||
      this.#contract.securitySchemes === null ||
      typeof this.#contract.securitySchemes !== 'object'
    ) {
      throw generationError('contract', 'expected HttpContractIR format 1');
    }
  }

  #uniqueName(base: string): string {
    if (!this.#usedNames.has(base)) {
      this.#usedNames.add(base);
      return base;
    }
    let suffix = 2;
    while (this.#usedNames.has(`${base}${String(suffix)}`)) suffix += 1;
    const name = `${base}${String(suffix)}`;
    this.#usedNames.add(name);
    return name;
  }

  #node(typeId: string, field: string): TypeIR {
    const type = this.#contract.types[typeId];
    if (type === undefined) throw generationError(field, `references missing type ${typeId}`);
    return type.type;
  }

  #declareType(typeId: string, hint: string): string {
    const present = this.#typeNames.get(typeId);
    if (present !== undefined) return present;
    const name = this.#uniqueName(hint);
    const node = this.#node(typeId, hint);
    const printer = new TypePrinter(name, node, base => this.#uniqueName(base));
    this.#declarations.push(...printer.declarations(), `export type ${name} = ${printer.print(node)};`);
    this.#typeNames.set(typeId, name);
    return name;
  }

  #jsonValidator(typeId: string, typeName: string, hint: string): string {
    const node = this.#node(typeId, hint);
    const definitions = definitionsOf(node);
    assertJsonType(node, hint, definitions);
    const decoder = new DecoderPrinter(`_zmdbDecode${hint}`, node);
    const decoded = decoder.decode(node, 'wire');
    const before = this.#emitter.diagnostics.length;
    const emitted = this.#emitter.emitValidate(node, 'value');
    if (emitted === undefined) {
      const refusal = this.#emitter.diagnostics[before];
      throw generationError(
        hint,
        refusal === undefined
          ? 'the AOT validator refused the response type'
          : `${refusal.path.length === 0 ? '' : `${refusal.path}: `}${refusal.reason}`,
      );
    }
    const expression = typeScriptValidationExpression(emitted);
    const name = this.#uniqueName(`_decode${hint}`);
    this.#validators.push(
      ...decoder.declarations(),
      `function ${name}(wire: unknown): DecodeResult<${typeName}> { ` +
        `const value: any = ${decoded}; const result = ${expression}; ` +
        `return result.success ? { ok: true, value: result.data as ${typeName} } : ` +
        `{ ok: false, issues: result.errors }; }`,
    );
    return name;
  }

  #headerScalar(raw: string, node: TypeIR, field: string): string {
    switch (scalarCategory(node, field)) {
      case 'string':
        return raw;
      case 'number':
        this.#moduleHelpers.set(
          'header-number',
          `function _zmdbHeaderNumber(value: string | undefined): unknown { ` +
            `if (value === undefined || value.length === 0) return value; const decoded = Number(value); ` +
            `return Number.isFinite(decoded) ? decoded : value; }`,
        );
        return `_zmdbHeaderNumber(${raw})`;
      case 'bigint':
        this.#moduleHelpers.set(
          'header-bigint',
          `function _zmdbHeaderBigInt(value: string | undefined): unknown { ` +
            `if (value === undefined || !/^-?\\d+$/u.test(value)) return value; ` +
            `try { return BigInt(value); } catch { return value; } }`,
        );
        return `_zmdbHeaderBigInt(${raw})`;
      case 'boolean':
        this.#moduleHelpers.set(
          'header-boolean',
          `function _zmdbHeaderBoolean(value: string | undefined): unknown { ` +
            `return value === 'true' ? true : value === 'false' ? false : value; }`,
        );
        return `_zmdbHeaderBoolean(${raw})`;
      case 'date':
        this.#moduleHelpers.set(
          'header-date',
          `function _zmdbHeaderDate(value: string | undefined): unknown { ` +
            `return value === undefined ? value : new Date(value); }`,
        );
        return `_zmdbHeaderDate(${raw})`;
    }
  }

  #headersModel(
    operation: HttpOperationIR,
    response: HttpResponseIR,
    stem: string,
  ): {
    readonly type: string;
    readonly decoder?: string;
  } {
    if (response.headers.length === 0) return { type: 'Readonly<Record<never, never>>' };
    const typeName = this.#uniqueName(`${stem}Response${String(response.status)}Headers`);
    const properties: string[] = [];
    const objectProperties: ObjectIR['properties'][number][] = [];
    const values: string[] = [];
    for (const header of response.headers) {
      const field = `${operation.operationId}.responses.${String(response.status)}.headers.${header.property}`;
      const node = this.#node(header.typeId, field);
      scalarCategory(node, field);
      const propertyType = this.#declareType(
        header.typeId,
        `${stem}Response${String(response.status)}Header${typeToken(header.property)}`,
      );
      properties.push(
        `readonly ${propertyName(header.property)}${header.required ? '' : '?'}: ` +
          `${propertyType}${header.required ? '' : ' | undefined'};`,
      );
      objectProperties.push({
        name: header.property,
        type: node,
        optional: !header.required,
        readonly: true,
      });
      const raw = `headers[${JSON.stringify(header.name)}]`;
      const decoded = this.#headerScalar(raw, node, field);
      const fieldValue = `${propertyName(header.property)}: ${decoded}`;
      values.push(
        header.required
          ? fieldValue
          : `...(headers[${JSON.stringify(header.name)}] === undefined ? {} : { ${fieldValue} })`,
      );
    }
    this.#declarations.push(`export interface ${typeName} { ${properties.join(' ')} }`);
    const validatorNode: TypeIR = { kind: 'object', properties: objectProperties };
    const before = this.#emitter.diagnostics.length;
    const emitted = this.#emitter.emitValidate(validatorNode, 'value');
    if (emitted === undefined) {
      const refusal = this.#emitter.diagnostics[before];
      throw operationError(
        operation.operationId,
        `responses.${String(response.status)}.headers`,
        refusal?.reason ?? 'the AOT validator refused the response headers',
      );
    }
    const expression = typeScriptValidationExpression(emitted);
    const decoder = this.#uniqueName(`_decode${stem}Response${String(response.status)}Headers`);
    this.#validators.push(
      `function ${decoder}(headers: ClientHeaders): DecodeResult<${typeName}> { ` +
        `const value = { ${values.join(', ')} }; const result = ${expression}; ` +
        `return result.success ? { ok: true, value: result.data as ${typeName} } : ` +
        `{ ok: false, issues: result.errors }; }`,
    );
    return { type: typeName, decoder };
  }

  #bodyModel(operation: HttpOperationIR, response: HttpResponseIR, body: HttpBodyIR, stem: string): BodyModel {
    if (!isJsonBody(body)) return { body, type: bodyType(body, undefined) };
    const type = this.#declareType(
      body.typeId,
      `${stem}Response${String(response.status)}${typeToken(body.typeId.split('/').slice(-3).join('_'))}`,
    );
    const validator = this.#jsonValidator(
      body.typeId,
      type,
      `${stem}Response${String(response.status)}${typeToken(body.typeId.split('/').slice(-3).join('_'))}`,
    );
    return { body, type, validator };
  }

  #responseModels(operation: HttpOperationIR, stem: string): readonly ResponseModel[] {
    if (operation.responses.length === 0) {
      throw operationError(operation.operationId, 'responses', 'must declare at least one exact status');
    }
    const statuses = new Set<number>();
    return [...operation.responses]
      .toSorted((left, right) => left.status - right.status)
      .map(response => {
        if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) {
          throw operationError(operation.operationId, 'responses', `invalid status ${String(response.status)}`);
        }
        if (statuses.has(response.status)) {
          throw operationError(operation.operationId, 'responses', `status ${String(response.status)} appears twice`);
        }
        statuses.add(response.status);
        const headers = this.#headersModel(operation, response, stem);
        const bodies = new Map<string, BodyModel>();
        if (response.versions !== undefined) {
          if (operation.version.kind !== 'media-type') {
            throw operationError(
              operation.operationId,
              `responses.${String(response.status)}.versions`,
              'is allowed only for media-type versioning',
            );
          }
          const declared = Object.keys(response.versions).toSorted();
          const expected = [...operation.version.values].toSorted();
          if (stableJson(declared) !== stableJson(expected)) {
            throw operationError(
              operation.operationId,
              `responses.${String(response.status)}.versions`,
              `must declare exactly [${operation.version.values.join(', ')}]`,
            );
          }
        }
        for (const version of versionKeys(operation)) {
          const body = bodyForVersion(operation, response, version);
          bodies.set(version, this.#bodyModel(operation, response, body, stem));
        }
        return {
          response,
          headersType: headers.type,
          ...(headers.decoder === undefined ? {} : { headersDecoder: headers.decoder }),
          bodies,
        };
      });
  }

  #parameterType(operation: HttpOperationIR, parameter: HttpParameterIR, stem: string): string {
    const field = `${operation.operationId}.parameters.${parameter.in}.${parameter.property}`;
    const node = this.#node(parameter.typeId, field);
    if (parameter.in === 'query' && node.kind === 'array') scalarCategory(node.element, field);
    else scalarCategory(node, field);
    return this.#declareType(parameter.typeId, `${stem}${typeToken(parameter.in)}${typeToken(parameter.property)}`);
  }

  #inputType(operation: HttpOperationIR, stem: string): string {
    const groups = new Map<string, HttpParameterIR[]>([
      ['path', []],
      ['query', []],
      ['headers', []],
      ['cookies', []],
    ]);
    for (const parameter of operation.parameters) {
      const group = parameter.in === 'header' ? 'headers' : parameter.in === 'cookie' ? 'cookies' : parameter.in;
      groups.get(group)?.push(parameter);
    }
    const fields: string[] = [];
    for (const [group, parameters] of groups) {
      if (parameters.length === 0) continue;
      const required = parameters.some(parameter => parameter.required);
      const properties = parameters.map(parameter => {
        const type = this.#parameterType(operation, parameter, stem);
        return (
          `readonly ${propertyName(parameter.property)}${parameter.required ? '' : '?'}: ` +
          `${type}${parameter.required ? '' : ' | undefined'};`
        );
      });
      fields.push(`readonly ${group}${required ? '' : '?'}: { ${properties.join(' ')} };`);
    }
    if (operation.requestBody !== undefined) {
      const body = operation.requestBody;
      let type: string;
      if (isJsonBody(body)) {
        const node = this.#node(body.typeId, `${operation.operationId}.requestBody`);
        assertJsonType(node, `${operation.operationId}.requestBody`, definitionsOf(node));
        type = this.#declareType(body.typeId, `${stem}RequestBody`);
      } else {
        type = bodyType(body, undefined);
      }
      fields.push(`readonly body${body.required ? '' : '?'}: ${type}${body.required ? '' : ' | undefined'};`);
    }
    const name = this.#uniqueName(`${stem}Input`);
    this.#declarations.push(
      fields.length === 0
        ? `export type ${name} = Readonly<Record<never, never>>;`
        : `export interface ${name} { ${fields.join(' ')} }`,
    );
    return name;
  }

  #resultTypeForVersion(operation: HttpOperationIR, responses: readonly ResponseModel[], version: string): string {
    const successes = responses.filter(model => model.response.status >= 200 && model.response.status < 300);
    if (successes.length === 0) return 'never';
    const variants = successes.map(model => {
      const body = model.bodies.get(version);
      if (body === undefined) {
        throw operationError(operation.operationId, 'responses', `missing version ${version}`);
      }
      if (successes.length === 1 && model.response.headers.length === 0) return body.type;
      if (successes.length === 1) {
        return `{ readonly body: ${body.type}; readonly headers: ${model.headersType}; }`;
      }
      return (
        `{ readonly status: ${String(model.response.status)}; readonly body: ${body.type}; ` +
        `readonly headers: ${model.headersType}; }`
      );
    });
    return variants.join(' | ');
  }

  #resultTypes(
    operation: HttpOperationIR,
    stem: string,
    responses: readonly ResponseModel[],
  ): { readonly result: string; readonly byVersion: ReadonlyMap<string, string> } {
    const byVersion = new Map<string, string>();
    if (operation.version.kind !== 'media-type') {
      const name = this.#uniqueName(`${stem}Result`);
      this.#declarations.push(`export type ${name} = ${this.#resultTypeForVersion(operation, responses, '')};`);
      byVersion.set('', name);
      return { result: name, byVersion };
    }

    for (const version of operation.version.values) {
      const name = this.#uniqueName(`${stem}ResultV${typeToken(version)}`);
      this.#declarations.push(`export type ${name} = ${this.#resultTypeForVersion(operation, responses, version)};`);
      byVersion.set(version, name);
    }
    const result = this.#uniqueName(`${stem}Result`);
    this.#declarations.push(`export type ${result} = ${[...byVersion.values()].join(' | ')};`);
    return { result, byVersion };
  }

  #errorType(operation: HttpOperationIR, stem: string, responses: readonly ResponseModel[]): void {
    const errors = responses.filter(model => model.response.status < 200 || model.response.status >= 300);
    if (errors.length === 0) return;
    const members: string[] = [];
    for (const model of errors) {
      for (const version of versionKeys(operation)) {
        const body = model.bodies.get(version);
        if (body === undefined) continue;
        members.push(`ClientResponseError<${String(model.response.status)}, ${body.type}, ${model.headersType}>`);
      }
    }
    const unique = [...new Set(members)];
    const name = this.#uniqueName(`${stem}Error`);
    const guard = this.#uniqueName(`is${stem}Error`);
    const statuses = [...new Set(errors.map(model => model.response.status))];
    this.#declarations.push(
      `export type ${name} = ${unique.join(' | ')};`,
      `export function ${guard}(error: unknown): error is ${name} { ` +
        `return error instanceof ClientResponseError && error.operationId === ${JSON.stringify(operation.operationId)} ` +
        `&& [${statuses.join(', ')}].includes(error.status); }`,
    );
  }

  #callOptions(operation: HttpOperationIR, stem: string): string {
    if (operation.version.kind !== 'header' && operation.version.kind !== 'media-type') return 'CallOptions';
    const name = this.#uniqueName(`${stem}CallOptions`);
    const values = operation.version.values.map(value => literal(value)).join(' | ');
    this.#declarations.push(`export type ${name} = CallOptions & { readonly version?: ${values}; };`);
    return name;
  }

  #operationModel(operation: HttpOperationIR): OperationModel {
    if (!IDENTIFIER.test(operation.operationId) || RESERVED_IDENTIFIERS.has(operation.operationId)) {
      throw operationError(
        operation.operationId,
        'operationId',
        'must be a non-reserved TypeScript identifier; rename the operation in the HTTP contract',
      );
    }
    this.#assertVersion(operation);
    const stem = operationStem(operation.operationId);
    if (this.#usedStems.has(stem)) {
      throw operationError(
        operation.operationId,
        'operationId',
        `collides with another generated type stem ${stem}; rename one operation`,
      );
    }
    this.#usedStems.add(stem);
    const inputType = this.#inputType(operation, stem);
    const responses = this.#responseModels(operation, stem);
    const results = this.#resultTypes(operation, stem, responses);
    this.#errorType(operation, stem, responses);
    const callOptionsType = this.#callOptions(operation, stem);
    return {
      operation,
      stem,
      inputType,
      resultType: results.result,
      resultTypesByVersion: results.byVersion,
      callOptionsType,
      responses,
    };
  }

  #assertVersion(operation: HttpOperationIR): void {
    const version = operation.version;
    if (version.kind === 'path') {
      if (version.value.length === 0) {
        throw operationError(operation.operationId, 'version.value', 'must not be empty');
      }
      return;
    }
    if (version.kind !== 'header' && version.kind !== 'media-type') return;
    if (version.values.length === 0) {
      throw operationError(operation.operationId, 'version.values', 'must contain at least one version');
    }
    const seen = new Set<string>();
    for (const value of version.values) {
      if (value.length === 0) {
        throw operationError(operation.operationId, 'version.values', 'contains an empty version');
      }
      if (seen.has(value)) {
        throw operationError(operation.operationId, 'version.values', `contains duplicate ${literal(value)}`);
      }
      seen.add(value);
    }
    if (!seen.has(version.default)) {
      throw operationError(
        operation.operationId,
        'version.default',
        `${literal(version.default)} is not one of the declared values`,
      );
    }
    const wireName = version.kind === 'header' ? version.name : version.key;
    if (!HTTP_TOKEN.test(wireName)) {
      throw operationError(
        operation.operationId,
        version.kind === 'header' ? 'version.name' : 'version.key',
        'must be a non-empty HTTP token',
      );
    }
  }

  #acceptHeader(model: OperationModel): string | undefined {
    const byVersion = new Map<string, string>();
    for (const version of versionKeys(model.operation)) {
      const mediaTypes: string[] = [];
      for (const response of model.responses) {
        const body = response.bodies.get(version)?.body;
        if (body !== undefined && body.kind !== 'empty') {
          const mediaType = versionedMediaType(model.operation, body, version);
          if (!mediaTypes.includes(mediaType)) mediaTypes.push(mediaType);
        }
      }
      if (mediaTypes.length > 0) byVersion.set(version, mediaTypes.join(', '));
    }
    if (byVersion.size === 0) return undefined;
    if (model.operation.version.kind !== 'media-type') return literal(byVersion.get('') ?? '');
    const fallback = literal(byVersion.get(model.operation.version.default) ?? '');
    return [...byVersion]
      .toReversed()
      .reduce(
        (otherwise, [version, value]) => `version === ${literal(version)} ? ${literal(value)} : ${otherwise}`,
        fallback,
      );
  }

  #prepare(model: OperationModel): string {
    const operation = model.operation;
    const lines = [
      `let path = ${JSON.stringify(operation.path)};`,
      'const query: { name: string; value: string }[] = [];',
    ];
    lines.push(`const headers: Record<string, string> = {};`, `const cookies: { name: string; value: string }[] = [];`);
    for (const parameter of operation.parameters) {
      const group = parameter.in === 'header' ? 'headers' : parameter.in === 'cookie' ? 'cookies' : parameter.in;
      const access = propertyAccess(`input.${group}`, parameter.property, !parameter.required);
      const node = this.#node(parameter.typeId, `${operation.operationId}.parameters.${parameter.property}`);
      if (parameter.in === 'path') {
        lines.push(`path = substituteClientPath(path, ${JSON.stringify(parameter.name)}, ${access});`);
        continue;
      }
      if (parameter.in === 'query') {
        if (node.kind === 'array') {
          lines.push(
            `if (${access} !== undefined) { for (const value of ${access}) ` +
              `query.push({ name: ${JSON.stringify(parameter.name)}, value: stringifyClientScalar(value) }); }`,
          );
        } else {
          lines.push(
            `if (${access} !== undefined) query.push({ name: ${JSON.stringify(parameter.name)}, ` +
              `value: stringifyClientScalar(${access}) });`,
          );
        }
        continue;
      }
      if (parameter.in === 'header') {
        lines.push(
          `if (${access} !== undefined) headers[${JSON.stringify(parameter.name)}] = stringifyClientScalar(${access});`,
        );
        continue;
      }
      lines.push(
        `if (${access} !== undefined) cookies.push({ name: ${JSON.stringify(parameter.name)}, ` +
          `value: stringifyClientScalar(${access}) });`,
      );
    }

    if (operation.version.kind === 'header') {
      lines.push(
        `headers[${JSON.stringify(operation.version.name)}] = version ?? ${literal(operation.version.default)};`,
      );
    }
    const accept = this.#acceptHeader(model);
    if (accept !== undefined) lines.push(`headers.accept = ${accept};`);
    if (operation.requestBody !== undefined) {
      const body = operation.requestBody;
      lines.push(
        `const body = ${body.required ? '' : 'input.body === undefined ? undefined : '}` +
          `prepareClientBody(${literal(body.kind)}, input.body);`,
      );
      lines.push(
        body.required
          ? `headers['content-type'] = ${literal(body.mediaType)};`
          : `if (body !== undefined) headers['content-type'] = ${literal(body.mediaType)};`,
      );
      lines.push(`return { path, query, headers, cookies, ...(body === undefined ? {} : { body }) };`);
    } else {
      lines.push('return { path, query, headers, cookies };');
    }
    return `prepare(input, version) { ${lines.join(' ')} }`;
  }

  #readBody(operation: HttpOperationIR, model: BodyModel, version: string): string {
    const mediaType = model.body.kind === 'empty' ? undefined : versionedMediaType(operation, model.body, version);
    if (isJsonBody(model.body)) {
      if (model.validator === undefined) throw generationError('response', 'JSON body has no validator');
      if (mediaType === undefined) throw generationError('response', 'JSON body has no media type');
      return `const body = await response.body.json<${model.type}>(${literal(mediaType)}, ${model.validator});`;
    }
    if (isTextBody(model.body)) {
      if (mediaType === undefined) throw generationError('response', 'text body has no media type');
      return `const body = await response.body.text(${literal(mediaType)});`;
    }
    if (model.body.kind === 'bytes') {
      if (mediaType === undefined) throw generationError('response', 'bytes body has no media type');
      return `const body = await response.body.bytes(${literal(mediaType)});`;
    }
    if (model.body.kind === 'stream') {
      if (mediaType === undefined) throw generationError('response', 'stream body has no media type');
      return `const body = response.body.stream(${literal(mediaType)});`;
    }
    return 'await response.body.empty(); const body: void = undefined;';
  }

  #readHeaders(operation: HttpOperationIR, model: ResponseModel): string {
    if (model.headersDecoder === undefined) return 'const headers = {};';
    return (
      `const decodedHeaders = ${model.headersDecoder}(response.headers); ` +
      `if (!decodedHeaders.ok) throw new ResponseValidationError(${literal(operation.operationId)}, ` +
      `${String(model.response.status)}, decodedHeaders.issues); const headers = decodedHeaders.value;`
    );
  }

  #successfulValue(model: OperationModel, response: ResponseModel): string {
    const successes = model.responses.filter(
      candidate => candidate.response.status >= 200 && candidate.response.status < 300,
    );
    if (successes.length === 1 && response.response.headers.length === 0) return 'return body;';
    if (successes.length === 1) return 'return { body, headers };';
    return `return { status: ${String(response.response.status)}, body, headers };`;
  }

  #responseBranch(model: OperationModel, response: ResponseModel, version: string): string {
    const body = response.bodies.get(version);
    if (body === undefined) {
      throw operationError(model.operation.operationId, 'responses', `missing response version ${version}`);
    }
    const lines = [this.#readHeaders(model.operation, response), this.#readBody(model.operation, body, version)];
    if (response.response.status >= 200 && response.response.status < 300) {
      lines.push(this.#successfulValue(model, response));
    } else {
      lines.push(
        `throw new ClientResponseError(${literal(model.operation.operationId)}, ${String(response.response.status)}, ` +
          `body, headers);`,
      );
    }
    return lines.join(' ');
  }

  #read(model: OperationModel): string {
    const cases = model.responses.map(response => {
      if (model.operation.version.kind !== 'media-type') {
        return `case ${String(response.response.status)}: { ${this.#responseBranch(model, response, '')} }`;
      }
      const branches = model.operation.version.values.map(
        version => `if (version === ${literal(version)}) { ${this.#responseBranch(model, response, version)} }`,
      );
      branches.push(
        `throw new ClientRequestError(${literal(`Operation ${model.operation.operationId} has no selected response version`)}, ` +
          `{ operationId: ${literal(model.operation.operationId)} });`,
      );
      return `case ${String(response.response.status)}: { ${branches.join(' ')} }`;
    });
    return (
      `async read(response, version) { switch (response.status) { ${cases.join(' ')} ` +
      `default: return response.unexpectedStatus(); } }`
    );
  }

  #schemes(operation: HttpOperationIR): Readonly<Record<string, Readonly<Record<string, string>>>> {
    const names = new Set(operation.security.flatMap(requirement => Object.keys(requirement)));
    const schemes: Record<string, Readonly<Record<string, string>>> = {};
    for (const name of [...names].toSorted()) {
      const scheme = this.#contract.securitySchemes[name];
      if (scheme === undefined) {
        throw operationError(operation.operationId, 'security', `references unknown scheme ${name}`);
      }
      schemes[name] = clientSecurityScheme(scheme);
    }
    return schemes;
  }

  #versionPlan(operation: HttpOperationIR): Readonly<Record<string, unknown>> {
    if (operation.version.kind === 'header' || operation.version.kind === 'media-type') {
      return {
        kind: operation.version.kind,
        values: operation.version.values,
        default: operation.version.default,
      };
    }
    return { kind: 'none' };
  }

  #operationBlock(model: OperationModel): string {
    const name = `_operation${model.stem}`;
    return (
      `// operation ${model.operation.operationId}\n` +
      `const ${name}: GeneratedOperation<${model.inputType}, ${model.resultType}> = ` +
      `Object.freeze<GeneratedOperation<${model.inputType}, ${model.resultType}>>({ ` +
      `abi: 1, operationId: ${literal(model.operation.operationId)}, method: ${literal(model.operation.method)}, ` +
      `security: ${stableJson(model.operation.security)}, schemes: ${stableJson(this.#schemes(model.operation))}, ` +
      `version: ${stableJson(this.#versionPlan(model.operation))}, ${this.#prepare(model)}, ${this.#read(model)} });\n` +
      `// end operation ${model.operation.operationId}`
    );
  }

  #methodSignatures(model: OperationModel): readonly string[] {
    const method = model.operation.operationId;
    if (model.operation.version.kind !== 'media-type') {
      return [
        `${method}(input: ${model.inputType}, options?: ${model.callOptionsType}): Promise<${model.resultType}>;`,
      ];
    }
    const signatures = model.operation.version.values.map(version => {
      const result = model.resultTypesByVersion.get(version);
      if (result === undefined) {
        throw operationError(model.operation.operationId, 'version', `missing result type for ${version}`);
      }
      return (
        `${method}(input: ${model.inputType}, options: CallOptions & { readonly version: ${literal(version)} }): ` +
        `Promise<${result}>;`
      );
    });
    const defaultResult = model.resultTypesByVersion.get(model.operation.version.default);
    if (defaultResult === undefined) {
      throw operationError(
        model.operation.operationId,
        'version',
        `default ${model.operation.version.default} has no generated result`,
      );
    }
    signatures.push(
      `${method}(input: ${model.inputType}, options?: CallOptions & ` +
        `{ readonly version?: ${literal(model.operation.version.default)} }): Promise<${defaultResult}>;`,
    );
    return signatures;
  }

  #apiInterface(models: readonly OperationModel[]): string {
    const methods = models.flatMap(model => [
      ...(model.operation.deprecated ? ['/** @deprecated */'] : []),
      ...this.#methodSignatures(model),
    ]);
    return `export interface ApiClient { ${methods.join(' ')} }`;
  }

  #factoryMethod(model: OperationModel): string {
    const operation = `_operation${model.stem}`;
    const method = model.operation.operationId;
    const local = `_call${model.stem}`;
    if (model.operation.version.kind !== 'media-type') {
      return (
        `function ${local}(input: ${model.inputType}, callOptions?: ${model.callOptionsType}): ` +
        `Promise<${model.resultType}> { return runtime.call(${operation}, input, callOptions); }`
      );
    }
    const overloads = this.#methodSignatures(model).map(
      signature => `function ${signature.replace(`${method}(`, `${local}(`)}`,
    );
    return (
      `${overloads.join(' ')} ` +
      `function ${local}(input: ${model.inputType}, callOptions?: ${model.callOptionsType}): ` +
      `Promise<${model.resultType}> { return runtime.call(${operation}, input, callOptions); }`
    );
  }

  #factory(models: readonly OperationModel[]): string {
    const functions = models.map(model => this.#factoryMethod(model)).join(' ');
    const members = models.map(model => `${propertyName(model.operation.operationId)}: _call${model.stem}`).join(', ');
    return (
      `export function createApiClient(options: ClientOptions): ApiClient { ` +
      `const runtime = createClientRuntime(options); ${functions} return { ${members} }; }`
    );
  }

  #sourceMap(source: string): string {
    const lines = source.endsWith('\n') ? source.slice(0, -1).split('\n').length : source.split('\n').length;
    const map = {
      version: 3,
      file: 'http-client.generated.ts',
      sources: ['zmdb:http-contract'],
      sourcesContent: [stableJson(sourceContract(this.#contract, new Set(this.#typeNames.keys())))],
      names: [],
      mappings: Array.from({ length: lines }, () => 'AAAA').join(';'),
    };
    return `${JSON.stringify(map)}\n`;
  }
}

/** Render one deterministic typed client module and its path-independent source map. */
export function generateHttpClient(contract: HttpContractIR): GeneratedHttpClientModule {
  return new ModuleGenerator(contract).generate();
}
