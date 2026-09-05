// @zmdb/web/contract/compiler — build-time HTTP contract collection.
//
// The syntax walk below reads only the static declaration wrapper: exported
// contract name, operation keys, and each httpOperation<T>() type argument. Every
// question about what T means is delegated to the existing AOT Reflector. This
// module accepts a caller-owned ReflectSession and never opens or closes one.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Reflector, type ReflectSession } from '@zmdb/aot-validator/reflect';
import { jsonSchemaFromTypeIR, type TypeIR } from '@zmdb/schema-core/ir';
import type {
  Expression,
  Node,
  ObjectLiteralExpression,
  SourceFile,
  TypeNode,
  VariableDeclaration,
} from 'typescript/unstable/ast';
import {
  isArrayLiteralExpression,
  isAsExpression,
  isBooleanLiteral,
  isCallExpression,
  isIdentifier,
  isNullLiteral,
  isNumericLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isStringLiteral,
  isVariableDeclaration,
} from 'typescript/unstable/ast/is';
import { SymbolFlags } from 'typescript/unstable/sync';
import type { Checker, Type } from 'typescript/unstable/sync';

import { getRoutes, isPublic } from '../../routing/index.js';
import { versionsOf } from '../../versioning/index.js';
import {
  type CompiledHttpContract,
  type CompiledHttpOperation,
  type HttpBodyDeclaration,
  type HttpBodyIR,
  type HttpContractDeclaration,
  type HttpContractIR,
  type HttpOperationDeclaration,
  type HttpOperationIR,
  type HttpParameterIR,
  type HttpRequestBodyIR,
  type HttpResponseHeaderIR,
  type HttpResponseIR,
  type HttpTypeIR,
  type HttpVersionIR,
  type OAuthFlows,
  type SecurityRequirement,
  type SecurityScheme,
} from '../index.js';

export interface HttpContractSource {
  /** File path or file URL containing the exported declaration. */
  readonly file: string | URL;
  /** Exported `const` whose initializer is `defineHttpContract({ ... })`. */
  readonly exportName: string;
  /** The inert value imported from that export. */
  readonly contract: HttpContractDeclaration;
}

export interface CompileHttpContractsOptions {
  /** One caller-owned compiler session for the whole build. */
  readonly session: ReflectSession;
}

interface StaticOperation {
  readonly operationId: string;
  readonly type: TypeNode;
}

interface TypeProperty {
  readonly name: string;
  readonly type: Type;
  readonly optional: boolean;
}

const ROOT_KEYS = new Set(['path', 'query', 'headers', 'cookies', 'body', 'responses']);
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Compile and compose one deterministic contract IR from explicit modules. */
export function compileHttpContracts(
  sources: readonly HttpContractSource[],
  options: CompileHttpContractsOptions,
): CompiledHttpContract {
  if (sources.length === 0) {
    throw new Error('HTTP contract compiler: at least one contract source is required');
  }

  const types: Record<string, HttpTypeIR> = {};
  const operations: CompiledHttpOperation[] = [];
  const operationIds = new Set<string>();
  const sortedSources = [...sources].toSorted((left, right) =>
    sourcePath(left.file).localeCompare(sourcePath(right.file)),
  );
  const securitySchemes = composeSecuritySchemes(sortedSources);

  for (const source of sortedSources) {
    const file = sourcePath(source.file);
    const sourceFile = options.session.sourceFile(file);
    if (sourceFile === undefined) {
      throw new Error(`HTTP contract compiler: ${file} is not part of ${options.session.project}`);
    }
    const diagnostics = options.session.diagnostics(file);
    if (diagnostics.length > 0) {
      const first = diagnostics[0];
      throw new Error(
        `HTTP contract compiler: ${file} does not typecheck ` +
          `(TS${String(first?.code ?? 0)}: ${first?.text ?? 'unknown diagnostic'})`,
      );
    }

    assertExported(sourceFile, source.exportName, options.session.checker);
    const staticOperations = operationsFromSource(sourceFile, source.exportName);
    const runtimeIds = Object.keys(source.contract.operations);
    const staticIds = staticOperations.map(operation => operation.operationId);
    if (!sameStrings(runtimeIds, staticIds)) {
      throw new Error(
        `HTTP contract compiler: ${source.exportName}.operations must be one static object literal. ` +
          `Source keys are [${staticIds.join(', ')}], runtime keys are [${runtimeIds.join(', ')}]`,
      );
    }

    const reflector = new Reflector(options.session.checker, sourceFile);
    for (const staticOperation of staticOperations) {
      const declaration = source.contract.operations[staticOperation.operationId];
      if (declaration === undefined) {
        throw new Error(
          `HTTP contract compiler: operation ${staticOperation.operationId} exists in source but not at runtime`,
        );
      }
      if (operationIds.has(staticOperation.operationId)) {
        throw operationError(staticOperation.operationId, 'operationId', 'appears more than once');
      }
      operationIds.add(staticOperation.operationId);

      const generic = options.session.checker.getTypeFromTypeNode(staticOperation.type);
      if (generic === undefined || generic.isErrorType()) {
        throw operationError(
          staticOperation.operationId,
          'type',
          'the compiler could not resolve the httpOperation<T>() type argument',
        );
      }

      const operation = compileOperation(
        staticOperation.operationId,
        declaration,
        generic,
        sourceFile,
        options.session.checker,
        reflector,
        types,
        securitySchemes,
      );
      const conflicting = operations.find(binding => finalRoutesCollide(binding.operation, operation));
      if (conflicting !== undefined) {
        throw operationError(
          operation.operationId,
          'method/path/version',
          `${operation.method} ${operation.path} overlaps operation ${conflicting.operation.operationId}`,
        );
      }
      operations.push({
        operation,
        controller: declaration.controller,
        handler: declaration.handler,
      });
    }
  }

  const sortedOperations = operations.toSorted((left, right) =>
    left.operation.operationId.localeCompare(right.operation.operationId),
  );
  assertCompatibleVersionStrategies(sortedOperations);
  const ir: HttpContractIR = {
    format: 1,
    types: sortRecord(types),
    operations: sortedOperations.map(binding => binding.operation),
    securitySchemes,
  };
  return deepFreeze({ ir, operations: sortedOperations });
}

function assertCompatibleVersionStrategies(operations: readonly CompiledHttpOperation[]): void {
  let unversioned: HttpOperationIR | undefined;
  let neutral: HttpOperationIR | undefined;
  let selected: HttpOperationIR | undefined;

  for (const binding of operations) {
    const operation = binding.operation;
    if (operation.version.kind === 'none') {
      unversioned ??= operation;
      continue;
    }
    if (operation.version.kind === 'neutral') {
      neutral ??= operation;
      continue;
    }
    if (selected === undefined) {
      selected = operation;
      continue;
    }
    if (!sameVersionStrategy(selected.version, operation.version)) {
      throw operationError(
        operation.operationId,
        'version',
        `does not use the same router strategy as operation ${selected.operationId}`,
      );
    }
  }

  if (unversioned !== undefined && (neutral !== undefined || selected !== undefined)) {
    const conflicting = neutral ?? selected;
    if (conflicting !== undefined) {
      throw operationError(
        conflicting.operationId,
        'version',
        `cannot share one router with unversioned operation ${unversioned.operationId}`,
      );
    }
  }
}

function sameVersionStrategy(left: HttpVersionIR, right: HttpVersionIR): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'header') {
    return right.kind === 'header' && left.name === right.name && left.default === right.default;
  }
  if (left.kind === 'media-type') {
    return right.kind === 'media-type' && left.key === right.key && left.default === right.default;
  }
  return left.kind === 'path' && right.kind === 'path';
}

function compileOperation(
  operationId: string,
  declaration: HttpOperationDeclaration,
  generic: Type,
  sourceFile: SourceFile,
  checker: Checker,
  reflector: Reflector,
  types: Record<string, HttpTypeIR>,
  schemes: Readonly<Record<string, SecurityScheme>>,
): HttpOperationIR {
  const controllerName = declaration.controller.name;
  if (controllerName.length === 0) {
    throw operationError(operationId, 'controller', 'has no stable class name');
  }
  if (!callableHandler(declaration.controller, declaration.handler)) {
    throw operationError(
      operationId,
      'handler',
      `${controllerName}.${declaration.handler} is missing or is not callable`,
    );
  }

  const path = normalizePath(declaration.path);
  assertLegacyRoute(operationId, declaration, path);

  const root = propertiesOf(generic, sourceFile, checker, operationId, 'type');
  for (const key of root.keys()) {
    if (!ROOT_KEYS.has(key)) {
      throw operationError(operationId, 'type', `property "${key}" is not an HTTP contract group`);
    }
  }

  const groups = {
    path: groupProperties(root, 'path', sourceFile, checker, operationId),
    query: groupProperties(root, 'query', sourceFile, checker, operationId),
    header: groupProperties(root, 'headers', sourceFile, checker, operationId),
    cookie: groupProperties(root, 'cookies', sourceFile, checker, operationId),
  } as const;

  const parameters = compileParameters(operationId, declaration, path, groups, reflector, types);
  const requestBody = compileRequestBody(operationId, declaration, root.get('body'), reflector, types, checker);
  const version = canonicalVersion(operationId, declaration.version);
  const responsesProperty = root.get('responses');
  if (responsesProperty === undefined) {
    throw operationError(operationId, 'responses', 'the generic type declares no responses object');
  }
  const responses = compileResponses(
    operationId,
    declaration,
    responsesProperty.type,
    sourceFile,
    checker,
    reflector,
    types,
    version,
  );
  const security = canonicalSecurity(operationId, declaration.security, schemes);
  assertSecurityMatchesRoute(operationId, declaration, security);
  assertSecurityWireCollisions(operationId, security, schemes, parameters, requestBody, responses, version);

  return deepFreeze({
    operationId,
    controller: controllerName,
    handler: declaration.handler,
    method: declaration.method,
    path,
    parameters,
    ...(requestBody === undefined ? {} : { requestBody }),
    responses,
    security,
    version,
    deprecated: declaration.deprecated,
  });
}

function compileParameters(
  operationId: string,
  declaration: HttpOperationDeclaration,
  path: string,
  groups: Readonly<Record<'path' | 'query' | 'header' | 'cookie', ReadonlyMap<string, TypeProperty>>>,
  reflector: Reflector,
  types: Record<string, HttpTypeIR>,
): readonly HttpParameterIR[] {
  const claimed = new Set<string>();
  const wireNames = new Set<string>();
  const parameters: HttpParameterIR[] = [];

  for (const parameter of declaration.parameters) {
    const location = parameter.in;
    const property = groups[location].get(parameter.property);
    const field = `parameters.${location}.${parameter.property}`;
    if (property === undefined) {
      throw operationError(operationId, field, 'does not exist in the generic type');
    }
    const propertyKey = `${location}\u0000${parameter.property}`;
    if (claimed.has(propertyKey)) {
      throw operationError(operationId, field, 'is declared more than once');
    }
    claimed.add(propertyKey);

    const name = canonicalParameterName(operationId, field, location, parameter.name);
    const wireKey = `${location}\u0000${name}`;
    if (wireNames.has(wireKey)) {
      throw operationError(operationId, field, `wire name "${parameter.name}" is declared more than once`);
    }
    wireNames.add(wireKey);
    if (location === 'path' && property.optional) {
      throw operationError(operationId, field, 'a path parameter cannot be optional');
    }

    const typeId = `${operationId}/parameter/${location}/${parameter.property}`;
    const node = reflectLocation(operationId, field, property.type, reflector);
    assertParameterType(operationId, field, location, node);
    addType(operationId, typeId, node, types);
    parameters.push({
      property: parameter.property,
      name,
      in: location,
      required: !property.optional,
      typeId,
    });
  }

  for (const [location, properties] of Object.entries(groups)) {
    for (const property of properties.values()) {
      if (!claimed.has(`${location}\u0000${property.name}`)) {
        throw operationError(
          operationId,
          `type.${location}.${property.name}`,
          'is not assigned to a parameter declaration',
        );
      }
    }
  }

  const placeholders = pathPlaceholders(path);
  const declaredPath = parameters.filter(parameter => parameter.in === 'path').map(parameter => parameter.name);
  if (!sameStrings(placeholders, declaredPath)) {
    throw operationError(
      operationId,
      'path',
      `placeholders [${placeholders.join(', ')}] do not match path parameters [${declaredPath.join(', ')}]`,
    );
  }

  return parameters;
}

function canonicalParameterName(
  operationId: string,
  field: string,
  location: 'path' | 'query' | 'header' | 'cookie',
  name: string,
): string {
  const canonical = location === 'header' ? name.toLowerCase() : name;
  if (canonical.length === 0) {
    throw operationError(operationId, `${field}.name`, 'must not be empty');
  }
  if ((location === 'header' || location === 'cookie') && !HTTP_TOKEN.test(canonical)) {
    throw operationError(operationId, `${field}.name`, `contains an invalid HTTP ${location} name`);
  }
  return canonical;
}

function compileRequestBody(
  operationId: string,
  declaration: HttpOperationDeclaration,
  property: TypeProperty | undefined,
  reflector: Reflector,
  types: Record<string, HttpTypeIR>,
  checker: Checker,
): HttpRequestBodyIR | undefined {
  const metadata = declaration.requestBody;
  if (metadata === undefined && property === undefined) return undefined;
  if (metadata === undefined) {
    throw operationError(operationId, 'requestBody', 'the generic body type has no request-body declaration');
  }
  if (property === undefined) {
    throw operationError(operationId, 'requestBody', 'is declared but the generic type has no body property');
  }
  if (metadata.required === property.optional) {
    throw operationError(
      operationId,
      'requestBody.required',
      `is ${String(metadata.required)} but the generic body property is ${property.optional ? 'optional' : 'required'}`,
    );
  }

  const body = compileBody(
    operationId,
    'requestBody',
    metadata,
    property.type,
    `${operationId}/request/body`,
    reflector,
    types,
    checker,
  );
  if (body.kind === 'empty') {
    throw operationError(operationId, 'requestBody.kind', 'cannot be empty');
  }
  return { ...body, required: metadata.required };
}

function compileResponses(
  operationId: string,
  declaration: HttpOperationDeclaration,
  responseTypes: Type,
  sourceFile: SourceFile,
  checker: Checker,
  reflector: Reflector,
  types: Record<string, HttpTypeIR>,
  version: HttpVersionIR,
): readonly HttpResponseIR[] {
  const declared = Object.entries(declaration.responses);
  if (declared.length === 0) {
    throw operationError(operationId, 'responses', 'must declare at least one exact status');
  }
  const generic = propertiesOf(responseTypes, sourceFile, checker, operationId, 'responses');
  const statuses = new Set<string>();
  const responses: HttpResponseIR[] = [];

  for (const [statusText, metadata] of declared) {
    const status = Number(statusText);
    if (!Number.isInteger(status) || status < 200 || status > 599) {
      throw operationError(operationId, `responses.${statusText}`, 'status must be an integer from 200 through 599');
    }
    const statusProperty = generic.get(statusText);
    if (statusProperty === undefined) {
      throw operationError(operationId, `responses.${statusText}`, 'has no matching generic response type');
    }
    statuses.add(statusText);
    const fields = propertiesOf(statusProperty.type, sourceFile, checker, operationId, `responses.${statusText}`);
    const bodyProperty = fields.get('body');
    if (bodyProperty === undefined) {
      throw operationError(operationId, `responses.${statusText}.body`, 'is missing from the generic response type');
    }
    for (const field of fields.keys()) {
      if (field !== 'body' && field !== 'headers') {
        throw operationError(
          operationId,
          `responses.${statusText}.${field}`,
          'is not a response body or headers group',
        );
      }
    }

    const body = compileBody(
      operationId,
      `responses.${statusText}.body`,
      metadata.body,
      bodyProperty.type,
      `${operationId}/response/${statusText}/body`,
      reflector,
      types,
      checker,
    );
    if ((status === 204 || status === 205 || status === 304) && body.kind !== 'empty') {
      throw operationError(operationId, `responses.${statusText}.body`, `status ${statusText} must use an empty body`);
    }

    const headers = compileResponseHeaders(
      operationId,
      statusText,
      metadata.headers ?? [],
      fields.get('headers'),
      sourceFile,
      checker,
      reflector,
      types,
    );
    const versions = compileResponseVersions(
      operationId,
      statusText,
      metadata.versions,
      bodyProperty.type,
      reflector,
      types,
      checker,
      version,
    );
    responses.push({
      status,
      description: metadata.description,
      headers,
      body,
      ...(versions === undefined ? {} : { versions }),
    });
  }

  for (const status of generic.keys()) {
    if (!statuses.has(status)) {
      throw operationError(operationId, `responses.${status}`, 'exists in the generic type but not in metadata');
    }
  }
  return responses.toSorted((left, right) => left.status - right.status);
}

function compileResponseHeaders(
  operationId: string,
  status: string,
  declarations: readonly { readonly property: string; readonly name: string; readonly description?: string }[],
  group: TypeProperty | undefined,
  sourceFile: SourceFile,
  checker: Checker,
  reflector: Reflector,
  types: Record<string, HttpTypeIR>,
): readonly HttpResponseHeaderIR[] {
  const properties =
    group === undefined
      ? new Map<string, TypeProperty>()
      : propertiesOf(group.type, sourceFile, checker, operationId, `responses.${status}.headers`);
  const claimed = new Set<string>();
  const names = new Set<string>();
  const headers: HttpResponseHeaderIR[] = [];

  for (const declaration of declarations) {
    const property = properties.get(declaration.property);
    const field = `responses.${status}.headers.${declaration.property}`;
    if (property === undefined) {
      throw operationError(operationId, field, 'does not exist in the generic response headers type');
    }
    if (claimed.has(declaration.property)) {
      throw operationError(operationId, field, 'is declared more than once');
    }
    claimed.add(declaration.property);
    const name = declaration.name.toLowerCase();
    if (!HTTP_TOKEN.test(name)) {
      throw operationError(operationId, `${field}.name`, 'contains an invalid HTTP header name');
    }
    if (names.has(name)) {
      throw operationError(operationId, field, `header name "${declaration.name}" is declared more than once`);
    }
    names.add(name);

    const typeId = `${operationId}/response/${status}/header/${declaration.property}`;
    const node = reflectLocation(operationId, field, property.type, reflector);
    assertParameterType(operationId, field, 'header', node);
    addType(operationId, typeId, node, types);
    headers.push({
      property: declaration.property,
      name,
      ...(declaration.description === undefined ? {} : { description: declaration.description }),
      required: !property.optional,
      typeId,
    });
  }
  for (const property of properties.values()) {
    if (!claimed.has(property.name)) {
      throw operationError(
        operationId,
        `responses.${status}.headers.${property.name}`,
        'is not assigned to response-header metadata',
      );
    }
  }
  return headers;
}

function compileResponseVersions(
  operationId: string,
  status: string,
  declarations: Readonly<Record<string, HttpBodyDeclaration>> | undefined,
  bodyType: Type,
  reflector: Reflector,
  types: Record<string, HttpTypeIR>,
  checker: Checker,
  operationVersion: HttpVersionIR,
): Readonly<Record<string, HttpBodyIR>> | undefined {
  if (declarations === undefined) return undefined;
  if (operationVersion.kind !== 'media-type') {
    throw operationError(operationId, `responses.${status}.versions`, 'is allowed only for media-type versioning');
  }
  const declaredVersions = Object.keys(declarations);
  if (!sameStringSets(declaredVersions, operationVersion.values)) {
    throw operationError(
      operationId,
      `responses.${status}.versions`,
      `must declare exactly [${operationVersion.values.join(', ')}]`,
    );
  }
  const versions: Record<string, HttpBodyIR> = {};
  for (const version of declaredVersions) {
    const declaration = declarations[version];
    if (declaration === undefined) continue;
    versions[version] = compileBody(
      operationId,
      `responses.${status}.versions.${version}`,
      declaration,
      bodyType,
      `${operationId}/response/${status}/version/${version}/body`,
      reflector,
      types,
      checker,
    );
  }
  return sortRecord(versions);
}

function compileBody(
  operationId: string,
  field: string,
  declaration: HttpBodyDeclaration,
  type: Type,
  typeId: string,
  reflector: Reflector,
  types: Record<string, HttpTypeIR>,
  checker: Checker,
): HttpBodyIR {
  if (declaration.kind === 'empty') {
    if (!fixedBodyType('empty', type)) {
      throw operationError(operationId, field, `empty bodies require void, received ${checker.typeToString(type)}`);
    }
    return { kind: 'empty' };
  }
  const mediaType = normalizeMediaType(operationId, `${field}.mediaType`, declaration.mediaType);
  if (declaration.kind !== 'json') {
    if (!fixedBodyType(declaration.kind, type)) {
      throw operationError(
        operationId,
        field,
        `${declaration.kind} body has incompatible type ${checker.typeToString(type)}`,
      );
    }
    return { kind: declaration.kind, mediaType };
  }

  const node = reflectLocation(operationId, field, type, reflector);
  addType(operationId, typeId, node, types);
  return { kind: 'json', mediaType, typeId };
}

function reflectLocation(operationId: string, field: string, type: Type, reflector: Reflector): TypeIR {
  const before = reflector.diagnostics.length;
  const node = reflector.typeIR(type, field);
  const diagnostics = reflector.diagnostics.slice(before);
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    throw operationError(
      operationId,
      field,
      `${first?.reason ?? 'the type was refused'}${first?.source === undefined ? '' : ` (${first.source})`}`,
    );
  }
  assertSupportedNode(operationId, field, node);
  return node;
}

function assertSupportedNode(operationId: string, field: string, node: TypeIR): void {
  switch (node.kind) {
    case 'unsupported':
      throw operationError(operationId, field, node.reason);
    case 'unknown':
    case 'undefined':
    case 'ref':
      throw operationError(operationId, field, `${node.kind} is not a complete HTTP schema`);
    case 'array':
      assertSupportedNode(operationId, field, node.element);
      return;
    case 'tuple':
      for (const element of node.elements) assertSupportedNode(operationId, field, element);
      return;
    case 'object':
      for (const property of node.properties) {
        assertSupportedNode(operationId, `${field}.${property.name}`, property.type);
      }
      return;
    case 'union':
      for (const member of node.members) assertSupportedNode(operationId, field, member);
      return;
    default:
      return;
  }
}

function addType(operationId: string, typeId: string, type: TypeIR, types: Record<string, HttpTypeIR>): void {
  if (types[typeId] !== undefined) {
    throw operationError(operationId, typeId, 'type location is declared more than once');
  }
  types[typeId] = deepFreeze({ type, openApi: jsonSchemaFromTypeIR(type) });
}

function assertParameterType(
  operationId: string,
  field: string,
  location: 'path' | 'query' | 'header' | 'cookie',
  node: TypeIR,
): void {
  if (location === 'query' && node.kind === 'array') {
    if (isScalarNode(node.element)) return;
  } else if (isScalarNode(node)) {
    return;
  }
  throw operationError(operationId, field, `${node.kind} cannot be encoded in an HTTP ${location} parameter`);
}

function isScalarNode(node: TypeIR): boolean {
  if (node.kind === 'scalar' || node.kind === 'literal') return true;
  return node.kind === 'union' && node.members.length > 0 && node.members.every(isScalarNode);
}

function fixedBodyType(kind: 'text' | 'bytes' | 'stream' | 'empty', type: Type): boolean {
  if (kind === 'text') return type.isIntrinsicType() && type.intrinsicName === 'string';
  if (kind === 'empty') {
    return type.isIntrinsicType() && (type.intrinsicName === 'void' || type.intrinsicName === 'undefined');
  }
  const name = type.getAliasSymbol()?.name ?? type.getSymbol()?.name;
  return kind === 'bytes' ? name === 'Uint8Array' : name === 'ReadableStream';
}

function canonicalSecurity(
  operationId: string,
  requirements: readonly SecurityRequirement[],
  schemes: Readonly<Record<string, SecurityScheme>>,
): readonly SecurityRequirement[] {
  return requirements.map((requirement, index) => {
    const canonical: Record<string, readonly string[]> = {};
    for (const name of Object.keys(requirement).toSorted()) {
      if (schemes[name] === undefined) {
        throw operationError(operationId, `security.${String(index)}.${name}`, 'references an undeclared scheme');
      }
      canonical[name] = [...new Set(requirement[name])].toSorted();
    }
    return canonical;
  });
}

function canonicalSecuritySchemes(
  schemes: Readonly<Record<string, SecurityScheme>>,
): Readonly<Record<string, SecurityScheme>> {
  const canonical: Record<string, SecurityScheme> = {};
  for (const name of Object.keys(schemes).toSorted()) {
    const scheme = schemes[name];
    if (scheme !== undefined) canonical[name] = canonicalSecurityScheme(name, scheme);
  }
  return deepFreeze(canonical);
}

function composeSecuritySchemes(sources: readonly HttpContractSource[]): Readonly<Record<string, SecurityScheme>> {
  const composed: Record<string, SecurityScheme> = {};
  for (const source of sources) {
    const schemes = canonicalSecuritySchemes(source.contract.securitySchemes);
    for (const name of Object.keys(schemes)) {
      const scheme = schemes[name];
      if (scheme === undefined) continue;
      const existing = composed[name];
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(scheme)) {
        throw new Error(
          `HTTP contract compiler: ${source.exportName}.securitySchemes.${name} conflicts with another contract`,
        );
      }
      composed[name] = scheme;
    }
  }
  return deepFreeze(sortRecord(composed));
}

function canonicalSecurityScheme(name: string, scheme: SecurityScheme): SecurityScheme {
  const description = scheme.description === undefined ? {} : { description: scheme.description };
  switch (scheme.type) {
    case 'http':
      return scheme.scheme === 'bearer'
        ? {
            type: 'http',
            scheme: 'bearer',
            ...(scheme.bearerFormat === undefined ? {} : { bearerFormat: scheme.bearerFormat }),
            ...description,
          }
        : { type: 'http', scheme: 'basic', ...description };
    case 'apiKey': {
      const wireName = scheme.in === 'header' ? scheme.name.toLowerCase() : scheme.name;
      if (wireName.length === 0 || ((scheme.in === 'header' || scheme.in === 'cookie') && !HTTP_TOKEN.test(wireName))) {
        throw new Error(`HTTP contract security scheme ${name}: apiKey name "${scheme.name}" is invalid`);
      }
      return { type: 'apiKey', in: scheme.in, name: wireName, ...description };
    }
    case 'mutualTLS':
      return { type: 'mutualTLS', ...description };
    case 'openIdConnect':
      return {
        type: 'openIdConnect',
        openIdConnectUrl: scheme.openIdConnectUrl,
        ...description,
      };
    case 'oauth2':
      return { type: 'oauth2', flows: canonicalOAuthFlows(scheme.flows), ...description };
  }
}

function canonicalOAuthFlows(flows: OAuthFlows): OAuthFlows {
  const implicit =
    flows.implicit === undefined
      ? undefined
      : {
          authorizationUrl: flows.implicit.authorizationUrl,
          ...(flows.implicit.refreshUrl === undefined ? {} : { refreshUrl: flows.implicit.refreshUrl }),
          scopes: sortRecord(flows.implicit.scopes),
        };
  const password =
    flows.password === undefined
      ? undefined
      : {
          tokenUrl: flows.password.tokenUrl,
          ...(flows.password.refreshUrl === undefined ? {} : { refreshUrl: flows.password.refreshUrl }),
          scopes: sortRecord(flows.password.scopes),
        };
  const clientCredentials =
    flows.clientCredentials === undefined
      ? undefined
      : {
          tokenUrl: flows.clientCredentials.tokenUrl,
          ...(flows.clientCredentials.refreshUrl === undefined
            ? {}
            : { refreshUrl: flows.clientCredentials.refreshUrl }),
          scopes: sortRecord(flows.clientCredentials.scopes),
        };
  const authorizationCode =
    flows.authorizationCode === undefined
      ? undefined
      : {
          authorizationUrl: flows.authorizationCode.authorizationUrl,
          tokenUrl: flows.authorizationCode.tokenUrl,
          ...(flows.authorizationCode.refreshUrl === undefined
            ? {}
            : { refreshUrl: flows.authorizationCode.refreshUrl }),
          scopes: sortRecord(flows.authorizationCode.scopes),
        };
  const canonical = {
    ...(implicit === undefined ? {} : { implicit }),
    ...(password === undefined ? {} : { password }),
    ...(clientCredentials === undefined ? {} : { clientCredentials }),
    ...(authorizationCode === undefined ? {} : { authorizationCode }),
  };
  if (implicit !== undefined) return { ...canonical, implicit };
  if (password !== undefined) return { ...canonical, password };
  if (clientCredentials !== undefined) return { ...canonical, clientCredentials };
  if (authorizationCode !== undefined) return { ...canonical, authorizationCode };
  throw new Error('HTTP contract oauth2 scheme has no flow');
}

function canonicalVersion(operationId: string, version: HttpVersionIR): HttpVersionIR {
  if (version.kind === 'none' || version.kind === 'neutral') return version;
  if (version.kind === 'path') {
    if (version.value.length === 0) {
      throw operationError(operationId, 'version.value', 'must not be empty');
    }
    return version;
  }
  const seen = new Set<string>();
  for (const value of version.values) {
    if (value.length === 0) {
      throw operationError(operationId, 'version.values', 'contains an empty version');
    }
    if (seen.has(value)) {
      throw operationError(operationId, 'version.values', `contains duplicate "${value}"`);
    }
    seen.add(value);
  }
  if (!seen.has(version.default)) {
    throw operationError(operationId, 'version.default', `"${version.default}" is not one of the declared values`);
  }
  if (version.values.length === 0) {
    throw operationError(operationId, 'version.values', 'must contain at least one version');
  }
  const wireName = (version.kind === 'header' ? version.name : version.key).trim().toLowerCase();
  if (!HTTP_TOKEN.test(wireName)) {
    throw operationError(
      operationId,
      version.kind === 'header' ? 'version.name' : 'version.key',
      'must be a non-empty HTTP token',
    );
  }
  return version.kind === 'header'
    ? { kind: 'header', name: wireName, values: [...version.values], default: version.default }
    : { kind: 'media-type', key: wireName, values: [...version.values], default: version.default };
}

function assertLegacyRoute(operationId: string, declaration: HttpOperationDeclaration, path: string): void {
  const routes = getRoutes(declaration.controller).filter(
    route => route.handlerName === declaration.handler && route.method === declaration.method,
  );
  if (routes.length === 0) {
    throw operationError(
      operationId,
      'route',
      `${declaration.controller.name}.${declaration.handler} has no matching ${declaration.method} decorator route`,
    );
  }
  if (declaration.version.kind !== 'path' && !routes.some(route => route.path === path)) {
    throw operationError(
      operationId,
      'path',
      `declares ${path}, but the decorator route is ${routes.map(route => route.path).join(' or ')}`,
    );
  }

  const legacyVersion = versionsOf(declaration.controller, declaration.handler);
  switch (declaration.version.kind) {
    case 'none':
      if (legacyVersion !== undefined) {
        throw operationError(operationId, 'version', 'declares none but the route has a version decorator');
      }
      return;
    case 'neutral':
      if (legacyVersion !== 'neutral') {
        throw operationError(operationId, 'version', 'declares neutral but the route is not @VersionNeutral()');
      }
      return;
    case 'path':
      if (!Array.isArray(legacyVersion) || !legacyVersion.includes(declaration.version.value)) {
        throw operationError(
          operationId,
          'version',
          `path version "${declaration.version.value}" is not declared by @Version()`,
        );
      }
      return;
    case 'header':
    case 'media-type':
      if (!Array.isArray(legacyVersion) || !sameStrings(legacyVersion, declaration.version.values)) {
        throw operationError(
          operationId,
          'version.values',
          `declares [${declaration.version.values.join(', ')}], but @Version() declares ` +
            `[${Array.isArray(legacyVersion) ? legacyVersion.join(', ') : String(legacyVersion)}]`,
        );
      }
  }
}

function assertSecurityMatchesRoute(
  operationId: string,
  declaration: HttpOperationDeclaration,
  security: readonly SecurityRequirement[],
): void {
  const publicRoute = isPublic(declaration.controller, declaration.handler);
  if (publicRoute && security.length !== 0) {
    throw operationError(operationId, 'security', 'an @Public() route must declare an empty security array');
  }
  if (!publicRoute && security.length === 0) {
    throw operationError(operationId, 'security', 'an unprotected operation must be marked @Public()');
  }
}

interface SecurityWireClaim {
  readonly location: 'header' | 'query' | 'cookie';
  readonly name: string;
}

function assertSecurityWireCollisions(
  operationId: string,
  security: readonly SecurityRequirement[],
  schemes: Readonly<Record<string, SecurityScheme>>,
  parameters: readonly HttpParameterIR[],
  requestBody: HttpRequestBodyIR | undefined,
  responses: readonly HttpResponseIR[],
  version: HttpVersionIR,
): void {
  const owned = new Map<string, string>();
  for (const parameter of parameters) {
    if (parameter.in !== 'path') {
      owned.set(wireClaimKey(parameter.in, parameter.name), `parameter ${parameter.in}:${parameter.name}`);
    }
  }
  if (version.kind === 'header') {
    owned.set(wireClaimKey('header', version.name), `version header ${version.name}`);
  }
  if (requestBody !== undefined) {
    owned.set(wireClaimKey('header', 'content-type'), 'request content-type header');
  }
  if (responses.some(response => response.body.kind !== 'empty')) {
    owned.set(wireClaimKey('header', 'accept'), 'response accept header');
  }
  if (version.kind === 'media-type') {
    owned.set(wireClaimKey('header', 'content-type'), 'media-type version content-type header');
    owned.set(wireClaimKey('header', 'accept'), 'media-type version accept header');
  }

  for (const [requirementIndex, requirement] of security.entries()) {
    const claimed = new Map<string, string>();
    for (const schemeName of Object.keys(requirement)) {
      const scheme = schemes[schemeName];
      if (scheme === undefined) continue;
      const claim = securityWireClaim(scheme);
      if (claim === undefined) continue;
      const key = wireClaimKey(claim.location, claim.name);
      const previousScheme = claimed.get(key);
      if (previousScheme !== undefined) {
        throw operationError(
          operationId,
          `security.${String(requirementIndex)}`,
          `schemes ${previousScheme} and ${schemeName} both occupy ${claim.location}:${claim.name}`,
        );
      }
      claimed.set(key, schemeName);
      const owner = owned.get(key);
      if (owner !== undefined) {
        throw operationError(
          operationId,
          `security.${String(requirementIndex)}.${schemeName}`,
          `${claim.location}:${claim.name} collides with the contract-owned ${owner}`,
        );
      }
    }
  }
}

function securityWireClaim(scheme: SecurityScheme): SecurityWireClaim | undefined {
  switch (scheme.type) {
    case 'apiKey':
      return { location: scheme.in, name: scheme.name };
    case 'http':
    case 'oauth2':
    case 'openIdConnect':
      return { location: 'header', name: 'authorization' };
    case 'mutualTLS':
      return undefined;
  }
}

function wireClaimKey(location: SecurityWireClaim['location'], name: string): string {
  return `${location}\u0000${location === 'header' ? name.toLowerCase() : name}`;
}

function finalRoutesCollide(left: HttpOperationIR, right: HttpOperationIR): boolean {
  if (left.method !== right.method || left.path !== right.path) return false;
  const leftVersion = left.version;
  const rightVersion = right.version;
  if (leftVersion.kind === 'neutral' || rightVersion.kind === 'neutral') return true;
  if (leftVersion.kind !== rightVersion.kind) return true;
  if (leftVersion.kind === 'header') {
    if (rightVersion.kind !== 'header') return true;
    return leftVersion.values.some(version => rightVersion.values.includes(version));
  }
  if (leftVersion.kind === 'media-type') {
    if (rightVersion.kind !== 'media-type') return true;
    return leftVersion.values.some(version => rightVersion.values.includes(version));
  }
  return true;
}

function groupProperties(
  root: ReadonlyMap<string, TypeProperty>,
  name: 'path' | 'query' | 'headers' | 'cookies',
  sourceFile: SourceFile,
  checker: Checker,
  operationId: string,
): ReadonlyMap<string, TypeProperty> {
  const property = root.get(name);
  return property === undefined
    ? new Map<string, TypeProperty>()
    : propertiesOf(property.type, sourceFile, checker, operationId, `type.${name}`);
}

function propertiesOf(
  type: Type,
  location: Node,
  checker: Checker,
  operationId: string,
  field: string,
): ReadonlyMap<string, TypeProperty> {
  if (!type.isObjectType()) {
    throw operationError(operationId, field, `must be an object type, received ${checker.typeToString(type)}`);
  }
  const properties = new Map<string, TypeProperty>();
  for (const symbol of checker.getPropertiesOfType(type)) {
    properties.set(symbol.name, {
      name: symbol.name,
      type: checker.getTypeOfSymbolAtLocation(symbol, location),
      optional: (symbol.flags & SymbolFlags.Optional) !== 0,
    });
  }
  return properties;
}

function operationsFromSource(sourceFile: SourceFile, exportName: string): readonly StaticOperation[] {
  const declaration = findVariable(sourceFile, exportName);
  const initializer = declaration.initializer;
  if (initializer === undefined) {
    throw new Error(`HTTP contract compiler: exported ${exportName} has no initializer`);
  }
  const call = unwrap(initializer);
  if (!isCallExpression(call) || calleeName(call.expression) !== 'defineHttpContract') {
    throw new Error(`HTTP contract compiler: exported ${exportName} must call defineHttpContract({ ... })`);
  }
  const argument = call.arguments[0];
  const contract = argument === undefined ? undefined : unwrap(argument);
  if (contract === undefined || !isObjectLiteralExpression(contract)) {
    throw new Error(`HTTP contract compiler: ${exportName} must pass one static object literal`);
  }
  const contractKeys = new Set<string>();
  for (const property of contract.properties) {
    if (!isPropertyAssignment(property)) {
      throw new Error(`HTTP contract compiler: ${exportName} may contain only static property assignments`);
    }
    const name = staticPropertyName(property.name);
    if (name === undefined) {
      throw new Error(`HTTP contract compiler: ${exportName} contains a computed property name`);
    }
    if (contractKeys.has(name)) {
      throw new Error(`HTTP contract compiler: ${exportName}.${name} is declared more than once`);
    }
    contractKeys.add(name);
  }
  const securitySchemes = objectProperty(contract, 'securitySchemes', exportName);
  assertStaticValue(exportName, 'securitySchemes', unwrap(securitySchemes.initializer));
  const operations = objectProperty(contract, 'operations', exportName);
  const operationsValue = unwrap(operations.initializer);
  if (!isObjectLiteralExpression(operationsValue)) {
    throw new Error(`HTTP contract compiler: ${exportName}.operations must be a static object literal`);
  }

  const entries: StaticOperation[] = [];
  const ids = new Set<string>();
  for (const property of operationsValue.properties) {
    if (!isPropertyAssignment(property)) {
      throw new Error(
        `HTTP contract compiler: ${exportName}.operations may contain only operationId: httpOperation<T>({...}) entries`,
      );
    }
    const operationId = staticPropertyName(property.name);
    if (operationId === undefined) {
      throw new Error(`HTTP contract compiler: ${exportName}.operations contains a dynamic operationId`);
    }
    if (ids.has(operationId)) {
      throw operationError(operationId, 'operationId', 'appears more than once in the source object');
    }
    ids.add(operationId);
    const operation = unwrap(property.initializer);
    if (!isCallExpression(operation) || calleeName(operation.expression) !== 'httpOperation') {
      throw operationError(operationId, 'declaration', 'must be a direct httpOperation<T>({...}) call');
    }
    const type = operation.typeArguments?.[0];
    if (type === undefined || operation.typeArguments?.length !== 1) {
      throw operationError(operationId, 'type', 'httpOperation must have exactly one type argument');
    }
    assertStaticOperation(operationId, operation.arguments);
    entries.push({ operationId, type });
  }
  return entries;
}

function assertStaticOperation(operationId: string, arguments_: readonly Expression[]): void {
  if (arguments_.length !== 1) {
    throw operationError(operationId, 'declaration', 'httpOperation must receive one static object literal');
  }
  const argument = arguments_[0];
  const declaration = argument === undefined ? undefined : unwrap(argument);
  if (declaration === undefined || !isObjectLiteralExpression(declaration)) {
    throw operationError(operationId, 'declaration', 'httpOperation must receive one static object literal');
  }

  const controller = unwrap(objectProperty(declaration, 'controller', operationId).initializer);
  if (!isStaticReference(controller)) {
    throw operationError(operationId, 'controller', 'must be a static class reference');
  }

  const seen = new Set<string>();
  for (const property of declaration.properties) {
    if (!isPropertyAssignment(property)) {
      throw operationError(operationId, 'declaration', 'may contain only static property assignments');
    }
    const name = staticPropertyName(property.name);
    if (name === undefined) {
      throw operationError(operationId, 'declaration', 'contains a computed property name');
    }
    if (seen.has(name)) {
      throw operationError(operationId, name, 'is declared more than once');
    }
    seen.add(name);
    if (name !== 'controller') {
      assertStaticValue(operationId, name, unwrap(property.initializer));
    }
  }
}

function assertStaticValue(operationId: string, field: string, expression: Expression): void {
  if (
    isStringLiteral(expression) ||
    isNumericLiteral(expression) ||
    isBooleanLiteral(expression) ||
    isNullLiteral(expression)
  ) {
    return;
  }
  if (isArrayLiteralExpression(expression)) {
    for (const [index, element] of expression.elements.entries()) {
      assertStaticValue(operationId, `${field}.${String(index)}`, unwrap(element));
    }
    return;
  }
  if (isObjectLiteralExpression(expression)) {
    const seen = new Set<string>();
    for (const property of expression.properties) {
      if (!isPropertyAssignment(property)) {
        throw operationError(operationId, field, 'may contain only static property assignments');
      }
      const name = staticPropertyName(property.name);
      if (name === undefined) {
        throw operationError(operationId, field, 'contains a computed property name');
      }
      if (seen.has(name)) {
        throw operationError(operationId, `${field}.${name}`, 'is declared more than once');
      }
      seen.add(name);
      assertStaticValue(operationId, `${field}.${name}`, unwrap(property.initializer));
    }
    return;
  }
  throw operationError(operationId, field, 'must be a static literal, array, or object');
}

function isStaticReference(expression: Expression): boolean {
  if (isIdentifier(expression)) return true;
  return isPropertyAccessExpression(expression) && isStaticReference(expression.expression);
}

function findVariable(sourceFile: SourceFile, name: string): VariableDeclaration {
  let found: VariableDeclaration | undefined;
  const visit = (node: Node): undefined => {
    if (isVariableDeclaration(node) && isIdentifier(node.name) && node.name.text === name) {
      if (found !== undefined) {
        throw new Error(`HTTP contract compiler: ${sourceFile.fileName} declares ${name} more than once`);
      }
      found = node;
    }
    node.forEachChild(visit);
    return undefined;
  };
  sourceFile.forEachChild(visit);
  if (found === undefined) {
    throw new Error(`HTTP contract compiler: ${sourceFile.fileName} has no const named ${name}`);
  }
  return found;
}

function assertExported(sourceFile: SourceFile, name: string, checker: Checker): void {
  const module = checker.getSymbolAtLocation(sourceFile);
  if (module === undefined) {
    throw new Error(`HTTP contract compiler: ${sourceFile.fileName} is not a module`);
  }
  if (!checker.getExportsOfModule(module).some(symbol => symbol.name === name)) {
    throw new Error(`HTTP contract compiler: ${sourceFile.fileName} does not export ${name}`);
  }
}

function objectProperty(
  object: ObjectLiteralExpression,
  name: string,
  owner: string,
): Extract<ObjectLiteralExpression['properties'][number], { readonly initializer: Expression }> {
  const matches = object.properties.filter(
    property => isPropertyAssignment(property) && staticPropertyName(property.name) === name,
  );
  if (matches.length !== 1) {
    throw new Error(`HTTP contract compiler: ${owner} must declare exactly one static "${name}" property`);
  }
  const match = matches[0];
  if (match === undefined || !isPropertyAssignment(match)) {
    throw new Error(`HTTP contract compiler: ${owner}.${name} is not a property assignment`);
  }
  return match;
}

function staticPropertyName(name: Node): string | undefined {
  if (isIdentifier(name) || isStringLiteral(name) || isNumericLiteral(name)) return name.text;
  return undefined;
}

function unwrap(expression: Expression): Expression {
  let current = expression;
  while (isParenthesizedExpression(current) || isAsExpression(current) || isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

function calleeName(expression: Expression): string | undefined {
  if (isIdentifier(expression)) return expression.text;
  if (isPropertyAccessExpression(expression) && isIdentifier(expression.name)) return expression.name.text;
  return undefined;
}

function callableHandler(controller: HttpOperationDeclaration['controller'], handler: string): boolean {
  let prototype: object | null = controller.prototype;
  while (prototype !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, handler);
    if (descriptor !== undefined) return typeof descriptor.value === 'function';
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

function sourcePath(file: string | URL): string {
  if (file instanceof URL) return fileURLToPath(file);
  return file.startsWith('file:') ? fileURLToPath(file) : resolve(file);
}

function normalizePath(path: string): string {
  const collapsed = `/${path}`.replace(/\/+/g, '/');
  return collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
}

function pathPlaceholders(path: string): string[] {
  return [...path.matchAll(/:([^/]+)/g)].map(match => match[1]).filter(name => name !== undefined);
}

function normalizeMediaType(operationId: string, field: string, value: string): string {
  const parts = value.split(';');
  const essence = parts.shift()?.trim().toLowerCase() ?? '';
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(essence)) {
    throw operationError(operationId, field, `"${value}" is not a media type`);
  }
  const parameters = parts.map(part => {
    const separator = part.indexOf('=');
    if (separator === -1) {
      throw operationError(operationId, field, `parameter "${part.trim()}" has no value`);
    }
    const name = part.slice(0, separator).trim().toLowerCase();
    const parameterValue = part.slice(separator + 1).trim();
    if (name.length === 0 || parameterValue.length === 0) {
      throw operationError(operationId, field, `parameter "${part.trim()}" is incomplete`);
    }
    return `${name}=${parameterValue}`;
  });
  return parameters.length === 0 ? essence : `${essence}; ${parameters.join('; ')}`;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringSets(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedRight = right.toSorted();
  return left.toSorted().every((value, index) => value === sortedRight[index]);
}

function sortRecord<Value>(record: Readonly<Record<string, Value>>): Readonly<Record<string, Value>> {
  const sorted: Record<string, Value> = {};
  for (const key of Object.keys(record).toSorted()) {
    const value = record[key];
    if (value !== undefined) sorted[key] = value;
  }
  return sorted;
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function operationError(operationId: string, field: string, problem: string): Error {
  return new Error(`HTTP contract ${operationId} at ${field}: ${problem}`);
}
