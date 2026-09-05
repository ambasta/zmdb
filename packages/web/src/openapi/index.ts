// @zmdb/web/openapi — deterministic HttpContractIR to OpenAPI 3.1 projection.
//
// Contract collection and TypeIR projection happen in @zmdb/web/contract/compiler.
// This module reads only serialisable operation data and the precomputed `openApi`
// documents attached to type IDs.

import type {
  HttpBodyIR,
  HttpContractIR,
  HttpOperationIR,
  HttpParameterIR,
  HttpResponseIR,
  JsonValue,
  SecurityRequirement,
  SecurityScheme,
} from '../contract/index.js';

export type {
  AuthorizationCodeFlow,
  ClientCredentialsFlow,
  ImplicitFlow,
  OAuthFlow,
  OAuthFlows,
  PasswordFlow,
  SecurityRequirement,
  SecurityScheme,
} from '../contract/index.js';

export type JsonSchema = Readonly<Record<string, JsonValue>>;

export interface OpenApiRenderOptions {
  readonly info?: { readonly title: string; readonly version: string };
}

interface OpenApiParameter {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header' | 'cookie';
  readonly required: boolean;
  readonly style: 'simple' | 'form';
  readonly explode: boolean;
  readonly allowReserved?: false;
  readonly schema: JsonSchema;
}

interface OpenApiHeader {
  readonly required: boolean;
  readonly schema: JsonSchema;
  readonly description?: string;
}

interface OpenApiMedia {
  readonly schema: JsonSchema;
}

type OpenApiContent = Record<string, OpenApiMedia>;

interface OpenApiResponse {
  readonly description: string;
  readonly headers?: Record<string, OpenApiHeader>;
  readonly content?: OpenApiContent;
}

interface OpenApiRequestBody {
  readonly required: boolean;
  readonly content: OpenApiContent;
}

interface OpenApiOperation {
  readonly operationId: string;
  readonly parameters?: readonly OpenApiParameter[];
  readonly requestBody?: OpenApiRequestBody;
  readonly responses: Record<string, OpenApiResponse>;
  readonly security: readonly SecurityRequirement[];
  readonly deprecated?: true;
}

type PathItem = Record<string, OpenApiOperation>;

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Record<string, PathItem>;
  readonly components?: { readonly securitySchemes: Readonly<Record<string, SecurityScheme>> };
}

interface ProjectedOperation {
  readonly operationId: string;
  readonly path: string;
  readonly method: string;
  readonly value: OpenApiOperation;
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const FIXED_BODY_SCHEMAS: Readonly<Record<'text' | 'bytes' | 'stream', JsonSchema>> = {
  text: { type: 'string' },
  bytes: { type: 'string', format: 'binary' },
  stream: { type: 'string', format: 'binary' },
};

function contractError(field: string, problem: string): Error {
  return new Error(`OpenAPI contract at ${field}: ${problem}`);
}

function operationError(operationId: string, field: string, problem: string): Error {
  return new Error(`OpenAPI contract ${operationId} at ${field}: ${problem}`);
}

function openApiPath(path: string): { readonly value: string; readonly parameters: readonly string[] } {
  const parameters: string[] = [];
  const value = path.replace(/:([^/]+)/g, (_match, name: string) => {
    parameters.push(name);
    return `{${name}}`;
  });
  return { value, parameters };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringSets(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = right.toSorted();
  return left.toSorted().every((value, index) => value === expected[index]);
}

function schemaFor(contract: HttpContractIR, operation: HttpOperationIR, field: string, typeId: string): JsonSchema {
  const schema = contract.types[typeId]?.openApi;
  if (schema === undefined) {
    throw operationError(operation.operationId, field, `references missing typeId "${typeId}"`);
  }
  return schema;
}

function schemaForBody(
  contract: HttpContractIR,
  operation: HttpOperationIR,
  field: string,
  body: Exclude<HttpBodyIR, { readonly kind: 'empty' }>,
): JsonSchema {
  if ('typeId' in body) {
    return schemaFor(contract, operation, `${field}.typeId`, body.typeId);
  }
  return FIXED_BODY_SCHEMAS[body.kind];
}

function parameterFor(
  contract: HttpContractIR,
  operation: HttpOperationIR,
  parameter: HttpParameterIR,
  index: number,
): OpenApiParameter {
  const field = `parameters.${String(index)}`;
  const schema = schemaFor(contract, operation, `${field}.typeId`, parameter.typeId);
  switch (parameter.in) {
    case 'path':
      if (!parameter.required) {
        throw operationError(operation.operationId, `${field}.required`, 'a path parameter must be required');
      }
      return {
        name: parameter.name,
        in: 'path',
        required: true,
        style: 'simple',
        explode: false,
        allowReserved: false,
        schema,
      };
    case 'query':
      return {
        name: parameter.name,
        in: 'query',
        required: parameter.required,
        style: 'form',
        explode: true,
        allowReserved: false,
        schema,
      };
    case 'header':
      return {
        name: parameter.name,
        in: 'header',
        required: parameter.required,
        style: 'simple',
        explode: false,
        schema,
      };
    case 'cookie':
      return {
        name: parameter.name,
        in: 'cookie',
        required: parameter.required,
        style: 'form',
        explode: true,
        schema,
      };
  }
}

function assertVersionValues(operation: HttpOperationIR): void {
  const version = operation.version;
  if (version.kind !== 'header' && version.kind !== 'media-type') return;
  if (version.values.length === 0) {
    throw operationError(operation.operationId, 'version.values', 'must contain at least one version');
  }
  if (new Set(version.values).size !== version.values.length) {
    throw operationError(operation.operationId, 'version.values', 'contains a duplicate version');
  }
  if (!version.values.includes(version.default)) {
    throw operationError(
      operation.operationId,
      'version.default',
      `"${version.default}" is not one of the declared values`,
    );
  }
}

function versionParameter(operation: HttpOperationIR): OpenApiParameter | undefined {
  const version = operation.version;
  if (version.kind !== 'header') return undefined;
  return {
    name: version.name,
    in: 'header',
    required: false,
    style: 'simple',
    explode: false,
    schema: { type: 'string', enum: [...version.values], default: version.default },
  };
}

function contentForBody(
  contract: HttpContractIR,
  operation: HttpOperationIR,
  field: string,
  body: HttpBodyIR,
): OpenApiContent | undefined {
  if (body.kind === 'empty') return undefined;
  return { [body.mediaType]: { schema: schemaForBody(contract, operation, field, body) } };
}

function contentForResponse(
  contract: HttpContractIR,
  operation: HttpOperationIR,
  response: HttpResponseIR,
  field: string,
): OpenApiContent | undefined {
  if (operation.version.kind !== 'media-type') {
    if (response.versions !== undefined) {
      throw operationError(
        operation.operationId,
        `${field}.versions`,
        'is present on a response that does not use media-type versioning',
      );
    }
    return contentForBody(contract, operation, `${field}.body`, response.body);
  }

  const versions = response.versions;
  if (versions !== undefined && !sameStringSets(Object.keys(versions), operation.version.values)) {
    throw operationError(
      operation.operationId,
      `${field}.versions`,
      `must declare exactly [${operation.version.values.join(', ')}]`,
    );
  }

  const content: OpenApiContent = {};
  for (const value of operation.version.values) {
    const body = versions?.[value] ?? response.body;
    if (body.kind === 'empty') continue;
    const mediaType = `${body.mediaType}; ${operation.version.key}=${value}`;
    if (content[mediaType] !== undefined) {
      throw operationError(operation.operationId, `${field}.versions.${value}`, `duplicates media type "${mediaType}"`);
    }
    content[mediaType] = {
      schema: schemaForBody(contract, operation, `${field}.versions.${value}`, body),
    };
  }
  return Object.keys(content).length === 0 ? undefined : content;
}

function responseFor(
  contract: HttpContractIR,
  operation: HttpOperationIR,
  response: HttpResponseIR,
  index: number,
): OpenApiResponse {
  const field = `responses.${String(index)}`;
  if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) {
    throw operationError(operation.operationId, `${field}.status`, 'must be an integer from 200 through 599');
  }

  const names = new Set<string>();
  const headers: Record<string, OpenApiHeader> = {};
  for (const [headerIndex, header] of response.headers.entries()) {
    const key = header.name.toLowerCase();
    if (names.has(key)) {
      throw operationError(
        operation.operationId,
        `${field}.headers.${String(headerIndex)}.name`,
        `duplicates response header "${header.name}"`,
      );
    }
    names.add(key);
    headers[header.name] = {
      required: header.required,
      schema: schemaFor(contract, operation, `${field}.headers.${String(headerIndex)}.typeId`, header.typeId),
      ...(header.description === undefined ? {} : { description: header.description }),
    };
  }

  const content = contentForResponse(contract, operation, response, field);
  return {
    description: response.description,
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
    ...(content === undefined ? {} : { content }),
  };
}

function securityFor(contract: HttpContractIR, operation: HttpOperationIR): readonly SecurityRequirement[] {
  return operation.security.map((requirement, index) => {
    const canonical: Record<string, readonly string[]> = {};
    for (const scheme of Object.keys(requirement).toSorted()) {
      if (contract.securitySchemes[scheme] === undefined) {
        throw operationError(
          operation.operationId,
          `security.${String(index)}.${scheme}`,
          'references an undeclared scheme',
        );
      }
      canonical[scheme] = [...(requirement[scheme] ?? [])];
    }
    return canonical;
  });
}

function projectOperation(contract: HttpContractIR, operation: HttpOperationIR): ProjectedOperation {
  if (operation.operationId.length === 0) {
    throw operationError('<empty>', 'operationId', 'must not be empty');
  }
  if (!METHODS.has(operation.method)) {
    throw operationError(operation.operationId, 'method', `"${operation.method}" is not supported`);
  }
  if (!operation.path.startsWith('/')) {
    throw operationError(operation.operationId, 'path', 'must start with "/"');
  }
  if (operation.responses.length === 0) {
    throw operationError(operation.operationId, 'responses', 'must contain at least one exact status');
  }
  assertVersionValues(operation);

  const projectedPath = openApiPath(operation.path);
  const pathParameters = operation.parameters
    .filter(parameter => parameter.in === 'path')
    .map(parameter => parameter.name);
  if (!sameStrings(projectedPath.parameters, pathParameters)) {
    throw operationError(
      operation.operationId,
      'path',
      `placeholders [${projectedPath.parameters.join(', ')}] do not match path parameters ` +
        `[${pathParameters.join(', ')}]`,
    );
  }

  const wireNames = new Set<string>();
  const parameters = operation.parameters.map((parameter, index) => {
    const wireKey = `${parameter.in}\u0000${parameter.in === 'header' ? parameter.name.toLowerCase() : parameter.name}`;
    if (wireNames.has(wireKey)) {
      throw operationError(
        operation.operationId,
        `parameters.${String(index)}.name`,
        `duplicates ${parameter.in} parameter "${parameter.name}"`,
      );
    }
    wireNames.add(wireKey);
    return parameterFor(contract, operation, parameter, index);
  });
  const version = versionParameter(operation);
  if (version !== undefined) {
    const wireKey = `header\u0000${version.name.toLowerCase()}`;
    if (wireNames.has(wireKey)) {
      throw operationError(operation.operationId, 'version.name', `duplicates header parameter "${version.name}"`);
    }
    parameters.push(version);
  }

  let requestBody: OpenApiRequestBody | undefined;
  if (operation.requestBody !== undefined) {
    const content = contentForBody(contract, operation, 'requestBody', operation.requestBody);
    if (content === undefined) {
      throw operationError(operation.operationId, 'requestBody.kind', 'cannot be empty');
    }
    requestBody = { required: operation.requestBody.required, content };
  }

  const responses: Record<string, OpenApiResponse> = {};
  for (const [index, response] of operation.responses.toSorted((left, right) => left.status - right.status).entries()) {
    const status = String(response.status);
    if (responses[status] !== undefined) {
      throw operationError(operation.operationId, `responses.${String(index)}.status`, `duplicates status ${status}`);
    }
    responses[status] = responseFor(contract, operation, response, index);
  }

  return {
    operationId: operation.operationId,
    path: projectedPath.value,
    method: operation.method.toLowerCase(),
    value: {
      operationId: operation.operationId,
      ...(parameters.length === 0 ? {} : { parameters }),
      ...(requestBody === undefined ? {} : { requestBody }),
      responses,
      security: securityFor(contract, operation),
      ...(operation.deprecated ? { deprecated: true } : {}),
    },
  };
}

function sortedSecuritySchemes(
  schemes: Readonly<Record<string, SecurityScheme>>,
): Readonly<Record<string, SecurityScheme>> {
  const sorted: Record<string, SecurityScheme> = {};
  for (const name of Object.keys(schemes).toSorted()) {
    const scheme = schemes[name];
    if (scheme !== undefined) sorted[name] = scheme;
  }
  return sorted;
}

/** Project one serialisable HTTP contract into an OpenAPI 3.1 document. */
export function toOpenApi(contract: HttpContractIR, options: OpenApiRenderOptions = {}): OpenApiDocument {
  if (contract.format !== 1) {
    throw contractError('format', `unsupported HttpContractIR format ${String(contract.format)}`);
  }
  if (!Array.isArray(contract.operations)) {
    throw contractError('operations', 'must be an array');
  }

  const projected = contract.operations
    .map(operation => projectOperation(contract, operation))
    .toSorted((left, right) => {
      if (left.path !== right.path) return left.path.localeCompare(right.path);
      if (left.method !== right.method) return left.method.localeCompare(right.method);
      return left.operationId.localeCompare(right.operationId);
    });

  const operationIds = new Set<string>();
  const routes = new Map<string, string>();
  const paths: Record<string, PathItem> = {};
  for (const operation of projected) {
    if (operationIds.has(operation.operationId)) {
      throw operationError(operation.operationId, 'operationId', 'appears more than once');
    }
    operationIds.add(operation.operationId);

    const routeKey = `${operation.method}\u0000${operation.path}`;
    const previous = routes.get(routeKey);
    if (previous !== undefined) {
      throw operationError(
        operation.operationId,
        'method/path',
        `${operation.method.toUpperCase()} ${operation.path} overlaps operation ${previous}`,
      );
    }
    routes.set(routeKey, operation.operationId);

    const item = paths[operation.path] ?? {};
    item[operation.method] = operation.value;
    paths[operation.path] = item;
  }

  const info = options.info ?? { title: '@zmdb/web API', version: '0.0.0' };
  const securitySchemes = sortedSecuritySchemes(contract.securitySchemes);
  return Object.keys(securitySchemes).length === 0
    ? { openapi: '3.1.0', info, paths }
    : { openapi: '3.1.0', info, paths, components: { securitySchemes } };
}

/** Return a handler that serves one prebuilt document by identity. */
export function serveOpenApi(doc: OpenApiDocument): () => OpenApiDocument {
  return () => doc;
}
