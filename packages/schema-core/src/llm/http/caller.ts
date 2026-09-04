import {
  OpenApiHttpError,
  type BoundOpenApiTool,
  type OpenApiCallerOptions,
  type OpenApiGeneratedTool,
  type OpenApiToolRequest,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positive(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
}

function canonicalBase(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('OpenAPI tool baseUrl must use http or https');
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError('OpenAPI tool baseUrl must not contain credentials');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new TypeError('OpenAPI tool baseUrl must not contain a query or fragment');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function allowlistedBase(baseUrl: string, allowlist: readonly string[]): URL {
  const base = canonicalBase(baseUrl);
  const allowed = allowlist.some(candidate => canonicalBase(candidate).href === base.href);
  if (!allowed) throw new Error(`OpenAPI tool base URL is not allowlisted: ${base.href}`);
  return base;
}

function scalar(value: unknown, name: string): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  throw new TypeError(`validated OpenAPI argument ${name} is not a URL scalar`);
}

function pathSegment(value: unknown, name: string): string {
  const segment = scalar(value, name);
  if (segment === '.' || segment === '..') {
    throw new RangeError(`validated OpenAPI argument ${name} is a URL dot segment`);
  }
  return encodeURIComponent(segment);
}

function requestUrl(base: URL, request: OpenApiToolRequest, input: Readonly<Record<string, unknown>>): URL {
  let pathname = request.path;
  for (const name of request.pathParameters) {
    pathname = pathname.replaceAll(`{${name}}`, pathSegment(input[name], name));
  }
  if (/\{[^{}]+\}/.test(pathname)) throw new Error(`OpenAPI tool path still contains a placeholder: ${pathname}`);

  const url = new URL(pathname.replace(/^\/+/, ''), base);
  for (const name of request.queryParameters) {
    const value = input[name];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(name, scalar(item, name));
    } else {
      url.searchParams.append(name, scalar(value, name));
    }
  }
  return url;
}

function requestBody(request: OpenApiToolRequest, input: Readonly<Record<string, unknown>>): string | undefined {
  if (!request.hasBody) return undefined;
  const body: Record<string, unknown> = {};
  for (const name of request.bodyParameters) {
    if (input[name] !== undefined) body[name] = input[name];
  }
  return JSON.stringify(body);
}

async function responseBody(response: Response, maximum: number): Promise<string> {
  const announced = response.headers.get('content-length');
  if (announced !== null && Number(announced) > maximum) {
    throw new RangeError(`OpenAPI tool response exceeds ${maximum} bytes`);
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maximum) {
    throw new RangeError(`OpenAPI tool response exceeds ${maximum} bytes`);
  }
  return body;
}

function parseResponse(response: Response, body: string): unknown {
  if (body === '') return undefined;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  return contentType.includes('json') ? JSON.parse(body) : body;
}

export function bindOpenApiTool<T>(tool: OpenApiGeneratedTool<T>, options: OpenApiCallerOptions): BoundOpenApiTool<T> {
  const base = allowlistedBase(options.baseUrl, options.allowedBaseUrls);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  positive('timeoutMs', timeoutMs);
  positive('maxResponseBytes', maxResponseBytes);
  const fetch = options.fetch ?? globalThis.fetch;

  return {
    spec: tool.spec,
    validate: tool.validate,
    async handler(input: T): Promise<unknown> {
      if (!isRecord(input)) throw new TypeError('generated OpenAPI validator returned a non-object');
      const url = requestUrl(base, tool.request, input);
      const body = requestBody(tool.request, input);
      const headers = new Headers(options.headers);
      if (body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
      const response = await fetch(url, {
        method: tool.request.method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await responseBody(response, maxResponseBytes);
      if (!response.ok) throw new OpenApiHttpError(response.status, text);
      return parseResponse(response, text);
    },
  };
}
