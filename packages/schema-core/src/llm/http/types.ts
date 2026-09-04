import type { ToolSpec } from '../index.js';

export type ToolProvider = 'openai' | 'openai-strict' | 'anthropic' | 'gemini' | 'json-schema';

export interface ToolSpecRefusal {
  readonly provider: ToolProvider;
  readonly path: string;
  readonly construct: string;
  readonly reason: string;
  readonly suggestion: string;
}

export class ToolSpecRefusalError extends Error {
  readonly refusal: ToolSpecRefusal;

  constructor(refusal: ToolSpecRefusal) {
    super(
      `Tool input ${refusal.path || '<root>'} cannot become a ${refusal.provider} tool: ` +
        `${refusal.reason} (${refusal.construct}). ${refusal.suggestion}`,
    );
    this.name = 'ToolSpecRefusalError';
    this.refusal = refusal;
  }
}

export interface OpenApiOperationIdentity {
  readonly method: string;
  readonly path: string;
  readonly operationId: string;
}

export interface OpenApiToolsOptions {
  readonly provider?: ToolProvider;
  readonly include?: (operation: OpenApiOperationIdentity) => boolean;
}

export interface OpenApiToolRequest {
  readonly method: string;
  readonly path: string;
  readonly pathParameters: readonly string[];
  readonly queryParameters: readonly string[];
  readonly bodyParameters: readonly string[];
  readonly hasBody: boolean;
}

/**
 * One checked-in generated tool. `validate` is intentionally a normal
 * `assert<T>` call in generated source: the existing AOT transform compiles it
 * from TypeScript's IR, so this path does not grow a second validator engine.
 */
export interface OpenApiGeneratedTool<T> {
  readonly spec: ToolSpec;
  readonly request: OpenApiToolRequest;
  readonly validate: (input: unknown) => T;
}

export interface OpenApiCallerOptions {
  readonly baseUrl: string;
  readonly allowedBaseUrls: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface BoundOpenApiTool<T> {
  readonly spec: ToolSpec;
  readonly validate: (input: unknown) => T;
  readonly handler: (input: T) => Promise<unknown>;
}

export class OpenApiHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`OpenAPI tool request failed with HTTP ${status}: ${body}`);
    this.name = 'OpenApiHttpError';
    this.status = status;
    this.body = body;
  }
}
