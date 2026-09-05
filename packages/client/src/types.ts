export type ClientHeaders = Readonly<Record<string, string>>;

export type ClientBytes = Uint8Array<ArrayBuffer>;

export type ClientBody = string | ClientBytes | ReadableStream<ClientBytes>;

export interface ClientRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: ClientHeaders;
  readonly body?: ClientBody;
  readonly signal?: AbortSignal;
}

export interface ClientResponse {
  readonly status: number;
  readonly headers: ClientHeaders;
  readonly body: ReadableStream<ClientBytes> | null;
}

export type ClientTransport = (request: ClientRequest) => Promise<ClientResponse>;

export type ClientSecurityRequirement = Readonly<Record<string, readonly string[]>>;

export type ClientSecurityScheme =
  | { readonly type: 'http'; readonly scheme: 'bearer' | 'basic' }
  | { readonly type: 'apiKey'; readonly in: 'header' | 'query' | 'cookie'; readonly name: string }
  | { readonly type: 'mutualTLS' }
  | { readonly type: 'oauth2' }
  | { readonly type: 'openIdConnect' };

export interface AuthenticationContext {
  readonly operationId: string;
  readonly requirements: readonly ClientSecurityRequirement[];
  readonly schemes: Readonly<Record<string, ClientSecurityScheme>>;
  readonly version?: string;
  readonly signal?: AbortSignal;
}

export interface AuthenticationPatch {
  readonly requirement: number;
  readonly headers?: ClientHeaders;
  readonly query?: Readonly<Record<string, string | readonly string[]>>;
  readonly cookies?: Readonly<Record<string, string>>;
}

export type AuthenticationProvider = (
  context: AuthenticationContext,
) => AuthenticationPatch | Promise<AuthenticationPatch>;

export interface ClientOptions {
  readonly baseUrl: string | URL;
  readonly transport?: ClientTransport;
  readonly authentication?: AuthenticationProvider;
  readonly headers?: ClientHeaders;
  readonly maxResponseBytes?: number;
  readonly maxErrorBodyBytes?: number;
}

export interface CallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly authentication?: AuthenticationProvider;
}

export interface ClientQueryPair {
  readonly name: string;
  readonly value: string;
}

export interface PreparedClientRequest {
  readonly path: string;
  readonly query: readonly ClientQueryPair[];
  readonly headers: ClientHeaders;
  readonly cookies: readonly ClientQueryPair[];
  readonly body?: ClientBody;
}

export type ClientVersionPlan =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'header' | 'media-type';
      readonly values: readonly string[];
      readonly default: string;
    };

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface ClientResponseBody {
  empty(): Promise<void>;
  json<T>(mediaType: string, decode: (wire: unknown) => DecodeResult<T>): Promise<T>;
  text(mediaType: string): Promise<string>;
  bytes(mediaType: string): Promise<ClientBytes>;
  stream(mediaType: string): ReadableStream<ClientBytes>;
}

export interface ClientOperationResponse {
  readonly status: number;
  readonly headers: ClientHeaders;
  readonly body: ClientResponseBody;
  unexpectedStatus(): Promise<never>;
}

export interface GeneratedOperation<Input, Result> {
  readonly abi: 1;
  readonly operationId: string;
  readonly method: string;
  readonly security: readonly ClientSecurityRequirement[];
  readonly schemes: Readonly<Record<string, ClientSecurityScheme>>;
  readonly version: ClientVersionPlan;
  prepare(input: Input, version: string | undefined): PreparedClientRequest;
  read(response: ClientOperationResponse, version: string | undefined): Promise<Result>;
}

export interface ClientRuntime {
  call<Input, Result>(
    operation: GeneratedOperation<Input, Result>,
    input: Input,
    options?: CallOptions & { readonly version?: string },
  ): Promise<Result>;
}
