import { assertPositiveByteLimit, DEFAULT_MAX_ERROR_BODY_BYTES, DEFAULT_MAX_RESPONSE_BYTES } from './body/index.js';
import {
  AuthenticationError,
  ClientError,
  ClientRequestError,
  ClientTimeoutError,
  MissingAuthenticationError,
  ResponseDecodeError,
  ResponseTooLargeError,
  ResponseValidationError,
  TransportError,
  UnexpectedContentTypeError,
  UnexpectedStatusError,
} from './errors/index.js';
import { assertNoTransportOwnedHeaders, mergeClientHeaders, normalizeClientHeaders } from './headers/index.js';
import { createFetchTransport } from './transport/index.js';
import type {
  AuthenticationPatch,
  AuthenticationProvider,
  CallOptions,
  ClientHeaders,
  ClientBytes,
  ClientOperationResponse,
  ClientOptions,
  ClientQueryPair,
  ClientRequest,
  ClientResponse,
  ClientResponseBody,
  ClientRuntime,
  ClientSecurityScheme,
  ClientTransport,
  DecodeResult,
  GeneratedOperation,
  PreparedClientRequest,
} from './types.js';
import { encodeClientComponent, normalizeClientBaseUrl, resolveClientUrl, type ClientBaseUrl } from './url/index.js';

export const CLIENT_RUNTIME_ABI = 1;

interface RuntimeConfiguration {
  readonly baseUrl: ClientBaseUrl;
  readonly transport: ClientTransport;
  readonly authentication?: AuthenticationProvider;
  readonly headers: ClientHeaders;
  readonly maxResponseBytes: number;
  readonly maxErrorBodyBytes: number;
}

interface CancellationScope {
  readonly signal: AbortSignal | undefined;
  cleanup(): void;
}

interface AuthenticationResult {
  readonly headers: ClientHeaders;
  readonly query: readonly ClientQueryPair[];
  readonly cookies: readonly ClientQueryPair[];
}

const CONTRACT_OWNED_OPTION_HEADERS = new Set(['accept', 'content-type']);
const EMPTY_STATUSES = new Set([204, 205, 304]);

function operationInit(
  operationId: string,
  cause?: unknown,
): { readonly operationId: string; readonly cause?: unknown } {
  return cause === undefined ? { operationId } : { operationId, cause };
}

function configuration(options: ClientOptions): RuntimeConfiguration {
  const headers = normalizeClientHeaders(options.headers);
  assertNoTransportOwnedHeaders(headers);
  for (const name of Object.keys(headers)) {
    if (CONTRACT_OWNED_OPTION_HEADERS.has(name)) {
      throw new ClientRequestError(`HTTP header ${name} is owned by the generated operation`);
    }
  }
  return Object.freeze({
    baseUrl: normalizeClientBaseUrl(options.baseUrl),
    transport: options.transport ?? createFetchTransport(),
    ...(options.authentication === undefined ? {} : { authentication: options.authentication }),
    headers,
    maxResponseBytes: assertPositiveByteLimit(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      'maxResponseBytes',
    ),
    maxErrorBodyBytes: assertPositiveByteLimit(
      options.maxErrorBodyBytes ?? DEFAULT_MAX_ERROR_BODY_BYTES,
      'maxErrorBodyBytes',
    ),
  });
}

function timeoutValue(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new ClientRequestError('timeoutMs must be a positive finite integer');
  }
  return value;
}

function cancellation(
  operationId: string,
  caller: AbortSignal | undefined,
  timeoutMs: number | undefined,
): CancellationScope {
  if (caller?.aborted === true) throw caller.reason;
  if (caller === undefined && timeoutMs === undefined) return { signal: undefined, cleanup() {} };

  const controller = new AbortController();
  const onAbort = (): void => {
    if (!controller.signal.aborted) controller.abort(caller?.reason);
  };
  if (caller !== undefined) caller.addEventListener('abort', onAbort, { once: true });

  const timeoutError = timeoutMs === undefined ? undefined : new ClientTimeoutError(operationId, timeoutMs);
  const timer =
    timeoutMs === undefined
      ? undefined
      : globalThis.setTimeout(() => {
          if (!controller.signal.aborted) controller.abort(timeoutError);
        }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      if (caller !== undefined) caller.removeEventListener('abort', onAbort);
      if (timer !== undefined) globalThis.clearTimeout(timer);
    },
  };
}

async function withSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) throw signal.reason;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(signal.aborted ? signal.reason : error);
      },
    );
  });
}

function selectedVersion(
  operation: GeneratedOperation<unknown, unknown>,
  supplied: string | undefined,
): string | undefined {
  if (operation.version.kind === 'none') {
    if (supplied !== undefined) {
      throw new ClientRequestError(`Operation ${operation.operationId} does not accept a version`, {
        operationId: operation.operationId,
      });
    }
    return undefined;
  }
  const version = supplied ?? operation.version.default;
  if (!operation.version.values.includes(version)) {
    throw new ClientRequestError(
      `Operation ${operation.operationId} version must be one of ${operation.version.values.join(', ')}`,
      { operationId: operation.operationId },
    );
  }
  return version;
}

function preparedRequest(
  operationId: string,
  operation: GeneratedOperation<unknown, unknown>,
  input: unknown,
  version: string | undefined,
): PreparedClientRequest {
  try {
    const prepared = operation.prepare(input, version);
    if (!prepared.path.startsWith('/') || prepared.path.includes('?') || prepared.path.includes('#')) {
      throw new ClientRequestError(`Operation ${operationId} prepared an invalid path`, { operationId });
    }
    const headers = normalizeClientHeaders(prepared.headers);
    assertNoTransportOwnedHeaders(headers);
    return Object.freeze({
      path: prepared.path,
      query: Object.freeze(prepared.query.map(pair => Object.freeze({ ...pair }))),
      headers,
      cookies: Object.freeze(prepared.cookies.map(pair => Object.freeze({ ...pair }))),
      ...(prepared.body === undefined ? {} : { body: prepared.body }),
    });
  } catch (error) {
    if (error instanceof ClientError) throw error;
    throw new ClientRequestError(
      `Operation ${operationId} could not prepare its request`,
      operationInit(operationId, error),
    );
  }
}

function schemeLocation(scheme: ClientSecurityScheme): {
  readonly in: 'header' | 'query' | 'cookie' | 'transport';
  readonly name?: string;
} {
  if (scheme.type === 'mutualTLS') return { in: 'transport' };
  if (scheme.type === 'apiKey') return { in: scheme.in, name: scheme.name };
  return { in: 'header', name: 'authorization' };
}

function patchEntries(patch: AuthenticationPatch, location: 'headers' | 'query' | 'cookies'): readonly string[] {
  return Object.keys(patch[location] ?? {}).toSorted();
}

function authenticationPatch(
  operationId: string,
  operation: GeneratedOperation<unknown, unknown>,
  patch: AuthenticationPatch,
  prepared: PreparedClientRequest,
): AuthenticationResult {
  if (!Number.isInteger(patch.requirement) || patch.requirement < 0) {
    throw new ClientRequestError(`Operation ${operationId} authentication selected an invalid requirement`, {
      operationId,
    });
  }
  const requirement = operation.security[patch.requirement];
  if (requirement === undefined) {
    throw new ClientRequestError(`Operation ${operationId} authentication selected an unknown requirement`, {
      operationId,
    });
  }

  const expected = {
    headers: new Map<string, ClientSecurityScheme>(),
    query: new Map<string, ClientSecurityScheme>(),
    cookies: new Map<string, ClientSecurityScheme>(),
  };
  for (const schemeName of Object.keys(requirement).toSorted()) {
    const scheme = operation.schemes[schemeName];
    if (scheme === undefined) {
      throw new ClientRequestError(`Operation ${operationId} references unknown security scheme ${schemeName}`, {
        operationId,
      });
    }
    const location = schemeLocation(scheme);
    if (location.in === 'transport') continue;
    const name = location.name;
    if (name === undefined) continue;
    const collection =
      location.in === 'header' ? expected.headers : location.in === 'query' ? expected.query : expected.cookies;
    if (collection.has(name.toLowerCase())) {
      throw new ClientRequestError(`Operation ${operationId} has colliding authentication wire names`, {
        operationId,
      });
    }
    collection.set(location.in === 'header' ? name.toLowerCase() : name, scheme);
  }

  const headers = normalizeClientHeaders(patch.headers);
  const supplied = {
    headers: patchEntries({ ...patch, headers }, 'headers'),
    query: patchEntries(patch, 'query'),
    cookies: patchEntries(patch, 'cookies'),
  };
  for (const location of ['headers', 'query', 'cookies'] as const) {
    const wanted = [...expected[location].keys()].toSorted();
    if (JSON.stringify(supplied[location]) !== JSON.stringify(wanted)) {
      throw new ClientRequestError(
        `Operation ${operationId} authentication patch does not exactly satisfy its ${location} requirement`,
        { operationId },
      );
    }
  }

  for (const name of expected.headers.keys()) {
    if (prepared.headers[name] !== undefined) {
      throw new ClientRequestError(`Operation ${operationId} authentication collides with header ${name}`, {
        operationId,
      });
    }
  }
  const declaredQuery = new Set(prepared.query.map(pair => pair.name));
  for (const name of expected.query.keys()) {
    if (declaredQuery.has(name)) {
      throw new ClientRequestError(`Operation ${operationId} authentication collides with query ${name}`, {
        operationId,
      });
    }
  }
  const declaredCookies = new Set(prepared.cookies.map(pair => pair.name));
  for (const name of expected.cookies.keys()) {
    if (declaredCookies.has(name)) {
      throw new ClientRequestError(`Operation ${operationId} authentication collides with cookie ${name}`, {
        operationId,
      });
    }
  }

  const query: ClientQueryPair[] = [];
  const cookies: ClientQueryPair[] = [];
  for (const schemeName of Object.keys(requirement).toSorted()) {
    const scheme = operation.schemes[schemeName];
    if (scheme === undefined) continue;
    const location = schemeLocation(scheme);
    const name = location.name;
    if (name === undefined || location.in === 'transport' || location.in === 'header') continue;
    if (location.in === 'cookie') {
      const value = patch.cookies?.[name];
      if (typeof value !== 'string') {
        throw new ClientRequestError(`Operation ${operationId} authentication cookie ${name} must be scalar`, {
          operationId,
        });
      }
      cookies.push(Object.freeze({ name, value }));
      continue;
    }
    const value = patch.query?.[name];
    const values = typeof value === 'string' ? [value] : value;
    if (values === undefined || values.some(item => typeof item !== 'string')) {
      throw new ClientRequestError(`Operation ${operationId} authentication query ${name} must contain strings`, {
        operationId,
      });
    }
    for (const item of values) query.push(Object.freeze({ name, value: item }));
  }
  return {
    headers,
    query: Object.freeze(query),
    cookies: Object.freeze(cookies),
  };
}

async function authenticate(
  operation: GeneratedOperation<unknown, unknown>,
  prepared: PreparedClientRequest,
  version: string | undefined,
  configured: AuthenticationProvider | undefined,
  perCall: AuthenticationProvider | undefined,
  signal: AbortSignal | undefined,
): Promise<AuthenticationResult> {
  if (operation.security.length === 0) return { headers: {}, query: [], cookies: [] };
  const provider = perCall ?? configured;
  if (provider === undefined) throw new MissingAuthenticationError(operation.operationId);

  let patch: AuthenticationPatch;
  try {
    patch = await withSignal(
      Promise.resolve(
        provider(
          Object.freeze({
            operationId: operation.operationId,
            requirements: operation.security,
            schemes: operation.schemes,
            ...(version === undefined ? {} : { version }),
            ...(signal === undefined ? {} : { signal }),
          }),
        ),
      ),
      signal,
    );
  } catch (error) {
    if (signal?.aborted === true) throw signal.reason;
    throw new AuthenticationError(operation.operationId, error);
  }
  return authenticationPatch(operation.operationId, operation, patch, prepared);
}

function cookieHeader(cookies: readonly ClientQueryPair[]): ClientHeaders {
  if (cookies.length === 0) return {};
  const value = cookies.map(pair => `${pair.name}=${encodeClientComponent(pair.value)}`).join('; ');
  return Object.freeze({ cookie: value });
}

function finalRequest(
  config: RuntimeConfiguration,
  operation: GeneratedOperation<unknown, unknown>,
  prepared: PreparedClientRequest,
  authentication: AuthenticationResult,
  signal: AbortSignal | undefined,
): ClientRequest {
  const headers = mergeClientHeaders(
    config.headers,
    prepared.headers,
    authentication.headers,
    cookieHeader([...prepared.cookies, ...authentication.cookies]),
  );
  assertNoTransportOwnedHeaders(headers);
  const url = resolveClientUrl(config.baseUrl, prepared.path, [...prepared.query, ...authentication.query]);
  return Object.freeze({
    method: operation.method,
    url,
    headers,
    ...(prepared.body === undefined ? {} : { body: prepared.body }),
    ...(signal === undefined ? {} : { signal }),
  });
}

function normalizedResponse(operationId: string, response: ClientResponse): ClientResponse {
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new TransportError(operationId, new Error(`Transport returned invalid status ${String(response.status)}`));
  }
  return Object.freeze({
    status: response.status,
    headers: normalizeClientHeaders(response.headers),
    body: response.body,
  });
}

function contentTypeParts(value: string): { readonly base: string; readonly parameters: ReadonlyMap<string, string> } {
  const [base = '', ...rawParameters] = value.split(';');
  const parameters = new Map<string, string>();
  for (const raw of rawParameters) {
    const separator = raw.indexOf('=');
    if (separator < 0) continue;
    const name = raw.slice(0, separator).trim().toLowerCase();
    const parameter = raw
      .slice(separator + 1)
      .trim()
      .replace(/^"|"$/gu, '');
    parameters.set(name, parameter);
  }
  return { base: base.trim().toLowerCase(), parameters };
}

function mediaTypeMatches(expected: string, received: string): boolean {
  const wanted = contentTypeParts(expected);
  const actual = contentTypeParts(received);
  if (wanted.base !== actual.base) return false;
  for (const [name, value] of wanted.parameters) {
    if (actual.parameters.get(name) !== value) return false;
  }
  return true;
}

async function safeCancel(stream: ReadableStream<ClientBytes> | null, reason: unknown): Promise<void> {
  if (stream === null || stream.locked) return;
  try {
    await stream.cancel(reason);
  } catch {}
}

class OperationResponseBody implements ClientResponseBody {
  readonly #operationId: string;
  readonly #status: number;
  readonly #headers: ClientHeaders;
  readonly #maxResponseBytes: number;
  readonly #maxErrorBodyBytes: number;
  readonly #signal: AbortSignal | undefined;
  #stream: ReadableStream<ClientBytes> | null;
  #used = false;
  #transferred = false;

  constructor(
    operationId: string,
    response: ClientResponse,
    maxResponseBytes: number,
    maxErrorBodyBytes: number,
    signal: AbortSignal | undefined,
  ) {
    this.#operationId = operationId;
    this.#status = response.status;
    this.#headers = response.headers;
    this.#stream = response.body;
    this.#maxResponseBytes = maxResponseBytes;
    this.#maxErrorBodyBytes = maxErrorBodyBytes;
    this.#signal = signal;
  }

  async cancel(reason: unknown): Promise<void> {
    if (this.#transferred) return;
    const stream = this.#stream;
    this.#stream = null;
    await safeCancel(stream, reason);
  }

  #take(): ReadableStream<ClientBytes> | null {
    if (this.#used) {
      throw new ClientRequestError(`Operation ${this.#operationId} response body was already consumed`, {
        operationId: this.#operationId,
      });
    }
    this.#used = true;
    const stream = this.#stream;
    this.#stream = null;
    return stream;
  }

  #assertMediaType(expected: string): void {
    const received = this.#headers['content-type'];
    if (received === undefined || !mediaTypeMatches(expected, received)) {
      throw new UnexpectedContentTypeError(this.#operationId, this.#status, [expected], received);
    }
  }

  async #read(limit: number): Promise<ClientBytes> {
    const declared = this.#headers['content-length'];
    if (declared !== undefined && /^\d+$/u.test(declared) && Number(declared) > limit) {
      const error = new ResponseTooLargeError(this.#operationId, this.#status, limit);
      const stream = this.#take();
      await safeCancel(stream, error);
      throw error;
    }
    const stream = this.#take();
    if (stream === null) return new Uint8Array();
    const reader = stream.getReader();
    const chunks: ClientBytes[] = [];
    let total = 0;
    try {
      while (true) {
        const result = await withSignal(reader.read(), this.#signal);
        if (result.done) break;
        total += result.value.byteLength;
        if (total > limit) {
          const error = new ResponseTooLargeError(this.#operationId, this.#status, limit);
          await reader.cancel(error);
          throw error;
        }
        chunks.push(result.value);
      }
    } catch (error) {
      if (this.#signal?.aborted === true) {
        try {
          await reader.cancel(this.#signal.reason);
        } catch {}
        throw this.#signal.reason;
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  async #snippet(): Promise<string> {
    const stream = this.#take();
    if (stream === null) return '';
    const reader = stream.getReader();
    const bytes = new Uint8Array(this.#maxErrorBodyBytes);
    let offset = 0;
    try {
      while (offset < bytes.byteLength) {
        const result = await withSignal(reader.read(), this.#signal);
        if (result.done) break;
        const remaining = bytes.byteLength - offset;
        const accepted = result.value.subarray(0, remaining);
        bytes.set(accepted, offset);
        offset += accepted.byteLength;
        if (accepted.byteLength < result.value.byteLength || offset === bytes.byteLength) {
          await reader.cancel();
          break;
        }
      }
    } catch (error) {
      if (this.#signal?.aborted === true) {
        try {
          await reader.cancel(this.#signal.reason);
        } catch {}
        throw this.#signal.reason;
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
    return new TextDecoder().decode(bytes.subarray(0, offset));
  }

  #diagnostic(bytes: ClientBytes): string {
    return new TextDecoder().decode(bytes.subarray(0, this.#maxErrorBodyBytes));
  }

  async empty(): Promise<void> {
    if (EMPTY_STATUSES.has(this.#status)) {
      const stream = this.#take();
      await safeCancel(stream, undefined);
      return;
    }
    const bytes = await this.#read(this.#maxResponseBytes);
    if (bytes.byteLength > 0) {
      throw new ResponseDecodeError(this.#operationId, this.#status, this.#diagnostic(bytes));
    }
  }

  async json<T>(mediaType: string, decode: (wire: unknown) => DecodeResult<T>): Promise<T> {
    this.#assertMediaType(mediaType);
    const bytes = await this.#read(this.#maxResponseBytes);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      throw new ResponseDecodeError(this.#operationId, this.#status, this.#diagnostic(bytes), error);
    }
    let wire: unknown;
    try {
      wire = JSON.parse(text);
    } catch (error) {
      throw new ResponseDecodeError(this.#operationId, this.#status, this.#diagnostic(bytes), error);
    }
    const result = decode(wire);
    if (!result.ok) {
      throw new ResponseValidationError(this.#operationId, this.#status, result.issues);
    }
    return result.value;
  }

  async text(mediaType: string): Promise<string> {
    this.#assertMediaType(mediaType);
    const bytes = await this.#read(this.#maxResponseBytes);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      throw new ResponseDecodeError(this.#operationId, this.#status, this.#diagnostic(bytes), error);
    }
  }

  async bytes(mediaType: string): Promise<ClientBytes> {
    this.#assertMediaType(mediaType);
    return this.#read(this.#maxResponseBytes);
  }

  stream(mediaType: string): ReadableStream<ClientBytes> {
    this.#assertMediaType(mediaType);
    const stream = this.#take();
    this.#transferred = true;
    return (
      stream ??
      new ReadableStream<ClientBytes>({
        start(controller) {
          controller.close();
        },
      })
    );
  }

  async unexpectedStatus(): Promise<never> {
    const snippet = await this.#snippet();
    throw new UnexpectedStatusError(this.#operationId, this.#status, this.#headers, snippet);
  }
}

function operationResponse(
  operationId: string,
  response: ClientResponse,
  body: OperationResponseBody,
): ClientOperationResponse {
  return Object.freeze({
    status: response.status,
    headers: response.headers,
    body,
    unexpectedStatus: () => body.unexpectedStatus(),
  });
}

function transportError(operationId: string, error: unknown): never {
  if (error instanceof TransportError && error.operationId === undefined) {
    throw new TransportError(operationId, error.cause);
  }
  if (error instanceof ClientRequestError && error.operationId === undefined) {
    throw new ClientRequestError(error.message, operationInit(operationId, error.cause));
  }
  if (error instanceof ClientError) throw error;
  throw new TransportError(operationId, error);
}

class Runtime implements ClientRuntime {
  readonly #config: RuntimeConfiguration;

  constructor(options: ClientOptions) {
    this.#config = configuration(options);
  }

  async call<Input, Result>(
    operation: GeneratedOperation<Input, Result>,
    input: Input,
    options: CallOptions & { readonly version?: string } = {},
  ): Promise<Result> {
    if (operation.abi !== CLIENT_RUNTIME_ABI) {
      throw new ClientRequestError(
        `Operation ${operation.operationId} ABI ${String(operation.abi)} does not match client ABI ${String(CLIENT_RUNTIME_ABI)}`,
        { operationId: operation.operationId },
      );
    }
    const timeoutMs = timeoutValue(options.timeoutMs);
    const scope = cancellation(operation.operationId, options.signal, timeoutMs);
    let body: OperationResponseBody | undefined;
    try {
      const version = selectedVersion(operation, options.version);
      const prepared = preparedRequest(operation.operationId, operation, input, version);
      const authentication = await authenticate(
        operation,
        prepared,
        version,
        this.#config.authentication,
        options.authentication,
        scope.signal,
      );
      const request = finalRequest(this.#config, operation, prepared, authentication, scope.signal);

      let response: ClientResponse;
      try {
        response = normalizedResponse(
          operation.operationId,
          await withSignal(Promise.resolve(this.#config.transport(request)), scope.signal),
        );
      } catch (error) {
        if (scope.signal?.aborted === true) throw scope.signal.reason;
        transportError(operation.operationId, error);
      }

      body = new OperationResponseBody(
        operation.operationId,
        response,
        this.#config.maxResponseBytes,
        this.#config.maxErrorBodyBytes,
        scope.signal,
      );
      return await withSignal(
        Promise.resolve(operation.read(operationResponse(operation.operationId, response, body), version)),
        scope.signal,
      );
    } catch (error) {
      const reason = scope.signal?.aborted === true ? scope.signal.reason : error;
      if (body !== undefined) await body.cancel(reason);
      throw reason;
    } finally {
      scope.cleanup();
    }
  }
}

export function createClientRuntime(options: ClientOptions): ClientRuntime {
  return new Runtime(options);
}
