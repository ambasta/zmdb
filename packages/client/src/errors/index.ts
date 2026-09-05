import type { ClientHeaders, ValidationIssue } from '../types.js';

export interface ClientErrorInit {
  readonly operationId?: string;
  readonly cause?: unknown;
}

function operation(operationId: string | undefined): string {
  return operationId === undefined ? 'Client request' : `Operation ${operationId}`;
}

export class ClientError extends Error {
  readonly operationId: string | undefined;

  constructor(message: string, init: ClientErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ClientError';
    this.operationId = init.operationId;
  }
}

export class ClientRequestError extends ClientError {
  constructor(message: string, init: ClientErrorInit = {}) {
    super(message, init);
    this.name = 'ClientRequestError';
  }
}

export class AuthenticationError extends ClientError {
  constructor(operationId: string, cause?: unknown) {
    super(`Authentication failed for operation ${operationId}`, { operationId, cause });
    this.name = 'AuthenticationError';
  }
}

export class MissingAuthenticationError extends AuthenticationError {
  constructor(operationId: string) {
    super(operationId);
    this.name = 'MissingAuthenticationError';
    this.message = `Operation ${operationId} requires an authentication provider`;
  }
}

export class TransportError extends ClientError {
  constructor(operationId: string | undefined, cause: unknown) {
    super(
      `${operation(operationId)} failed in the transport`,
      operationId === undefined ? { cause } : { operationId, cause },
    );
    this.name = 'TransportError';
  }
}

export class ClientTimeoutError extends ClientError {
  readonly timeoutMs: number;

  constructor(operationId: string, timeoutMs: number) {
    super(`Operation ${operationId} timed out after ${String(timeoutMs)}ms`, { operationId });
    this.name = 'ClientTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class ResponseTooLargeError extends ClientError {
  readonly status: number;
  readonly limit: number;

  constructor(operationId: string, status: number, limit: number) {
    super(`Operation ${operationId} response status ${String(status)} exceeds the ${String(limit)} byte limit`, {
      operationId,
    });
    this.name = 'ResponseTooLargeError';
    this.status = status;
    this.limit = limit;
  }
}

export class UnexpectedStatusError extends ClientError {
  readonly status: number;
  readonly headers: ClientHeaders;
  readonly bodySnippet: string;

  constructor(operationId: string, status: number, headers: ClientHeaders, bodySnippet: string) {
    const detail = bodySnippet.length === 0 ? '' : `: ${bodySnippet}`;
    super(`Operation ${operationId} returned undocumented status ${String(status)}${detail}`, { operationId });
    this.name = 'UnexpectedStatusError';
    this.status = status;
    this.headers = Object.freeze({ ...headers });
    this.bodySnippet = bodySnippet;
  }
}

export class UnexpectedContentTypeError extends ClientError {
  readonly status: number;
  readonly expected: readonly string[];
  readonly received: string | undefined;

  constructor(operationId: string, status: number, expected: readonly string[], received: string | undefined) {
    super(
      `Operation ${operationId} status ${String(status)} expected content type ${expected.join(' or ')}, ` +
        `received ${received ?? 'none'}`,
      { operationId },
    );
    this.name = 'UnexpectedContentTypeError';
    this.status = status;
    this.expected = Object.freeze([...expected]);
    this.received = received;
  }
}

export class ResponseDecodeError extends ClientError {
  readonly status: number;
  readonly bodySnippet: string;

  constructor(operationId: string, status: number, bodySnippet: string, cause?: unknown) {
    const detail = bodySnippet.length === 0 ? '' : `: ${bodySnippet}`;
    super(`Operation ${operationId} could not decode status ${String(status)}${detail}`, { operationId, cause });
    this.name = 'ResponseDecodeError';
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

export class ResponseValidationError extends ClientError {
  readonly status: number;
  readonly issues: readonly ValidationIssue[];

  constructor(operationId: string, status: number, issues: readonly ValidationIssue[]) {
    super(
      `Operation ${operationId} status ${String(status)} failed response validation with ` +
        `${String(issues.length)} issue(s)`,
      { operationId },
    );
    this.name = 'ResponseValidationError';
    this.status = status;
    this.issues = Object.freeze(issues.map(issue => Object.freeze({ ...issue })));
  }
}

export class ClientResponseError<Status extends number, Body, Headers = ClientHeaders> extends ClientError {
  readonly status: Status;
  readonly body: Body;
  readonly headers: Headers;

  constructor(operationId: string, status: Status, body: Body, headers: Headers) {
    super(`Operation ${operationId} returned documented error status ${String(status)}`, { operationId });
    this.name = 'ClientResponseError';
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}
