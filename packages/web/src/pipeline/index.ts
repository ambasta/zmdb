// @zmdb/web — request pipeline & runtime adapters (epic #272, spec ./SPEC.md).
// Dispatches matched routes through: build Ctx → run route guards → validate
// body → invoke handler → serialize. Thin, structurally-typed node:http + Fetch
// adapters (no hard deps). No reflection; no `as` on the consumer surface.

import '@zmdb/app';
import type { FileHandle } from 'node:fs/promises';

import type { Constructor } from '@zmdb/app/di';
import { fromTraceContext } from '@zmdb/app/observability';
import type { Observability, Span, Tracer } from '@zmdb/app/observability';
import { claimsValidationIssues, ValidationError, validationIssuesOf } from '@zmdb/schema-core';

import {
  compilePattern,
  countSegments,
  matchCompiled,
  type CompiledPattern,
  type Ctx,
  type QueryValues,
} from '../context/index.js';
import type { CompiledHttpContract, HttpOperationIR, SecurityRequirement } from '../contract/index.js';
import { BoundaryStatusError } from '../middleware/errors.js';
import type { Guard, SecurityAwareGuard } from '../middleware/index.js';
import { getRoutes, isPublic, type ResolvedRoute } from '../routing/index.js';
import { versionsOf, type VersionStrategy } from '../versioning/index.js';
import { jsonMediaTypeForVersion, pathForVersion } from '../versioning/runtime.js';
import { resolveGuards, type GuardRegistry } from './guards.js';

export type { Ctx } from '../context/index.js';
export type { SecurityRequirement } from '../contract/index.js';
export type { GuardRegistry } from './guards.js';

/** A minimal, framework-neutral request. */
export interface WebRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody?: unknown;
  readonly query?: QueryValues;
  readonly scheme?: string;
}

/** A minimal, framework-neutral response body. */
export type ResponseBody =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'bytes'; readonly value: Uint8Array<ArrayBuffer> }
  | {
      readonly kind: 'stream';
      readonly value: ReadableStream<Uint8Array<ArrayBuffer>>;
      readonly length: number | undefined;
    };

/** A minimal, framework-neutral response. */
export interface WebResponse {
  readonly status: number;
  readonly body: ResponseBody;
  readonly headers: Readonly<Record<string, string>>;
}

/** Per-handler pipeline, guard and OpenAPI options. */
export interface RouteOptions {
  readonly validateBody?: (raw: unknown) => unknown;
  readonly guards?: readonly Guard[];
  readonly security?: readonly SecurityRequirement[];
  readonly deprecated?: true;
}

/** Global CORS configuration options. */
export interface CorsOptions {
  readonly origin?: string | readonly string[] | boolean | ((origin: string) => string | boolean);
  readonly methods?: string | readonly string[];
  readonly allowedHeaders?: string | readonly string[];
  readonly exposedHeaders?: string | readonly string[];
  readonly credentials?: boolean;
  readonly maxAge?: number;
}

/** Global HTTP security headers configuration options. */
export interface SecurityHeadersOptions {
  readonly xContentTypeOptions?: string | boolean;
  readonly xFrameOptions?: string | boolean;
  readonly xXssProtection?: string | boolean;
  readonly referrerPolicy?: string | boolean;
  readonly strictTransportSecurity?: string | boolean;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Router initialization configuration options. */
export interface RouterOptions extends Observability {
  readonly guardRegistry?: GuardRegistry;
  readonly cors?: CorsOptions | boolean;
  readonly security?: SecurityHeadersOptions | boolean;
  readonly versioning?: VersionStrategy;
}

/** A handler takes one Ctx and returns a (possibly async) result. */
type Handler = (ctx: Ctx<Record<string, string>, unknown, QueryValues>) => unknown;

interface BoundRoute {
  readonly route: ResolvedRoute;
  /** The exact serialisable operation object when this route came from a contract. */
  readonly operation?: HttpOperationIR;
  readonly pattern: CompiledPattern;
  readonly handler: Handler;
  readonly validateBody?: (raw: unknown) => unknown;
  readonly guards?: readonly Guard[];
  readonly neutral?: true;
  readonly versionJsonHeaders?: Readonly<Record<string, string>>;
}

// Routes are indexed by method, then by segment count, because a route can only
// match a path that agrees on both — so a request never looks at a route it
// could not possibly match. `handle` used to scan every registered route and
// re-split each one's pattern, which made matching O(routes) with a handful of
// allocations per candidate; with a real route table that cost grows without
// bound while the two keys below are known before any comparison happens.
//
// Within a bucket the registration order of `register` is preserved, so
// first-registered-wins is unchanged: a `/user/:id` declared before `/user/me`
// still shadows it, exactly as the flat scan did.
type MethodBuckets = Map<string, BoundRoute[][]>;
type VersionBuckets = Map<string, Map<string, BoundRoute[][]>>;

interface SupportedRoute {
  readonly pattern: CompiledPattern;
  readonly versions: string[];
}

type SupportedBuckets = Map<string, SupportedRoute[][]>;

interface VersionTrieNode {
  readonly children: Map<number, VersionTrieNode>;
  version?: string;
  id?: number;
}

interface VersionLookup {
  readonly root: VersionTrieNode;
  nextId: number;
}

function bucketFor(buckets: MethodBuckets, method: string, segmentCount: number): BoundRoute[] {
  let bySegmentCount = buckets.get(method);
  if (bySegmentCount === undefined) {
    bySegmentCount = [];
    buckets.set(method, bySegmentCount);
  }
  let bucket = bySegmentCount[segmentCount];
  if (bucket === undefined) {
    bucket = [];
    bySegmentCount[segmentCount] = bucket;
  }
  return bucket;
}

function versionBucketFor(
  buckets: VersionBuckets,
  neutralBuckets: MethodBuckets,
  method: string,
  version: string,
  segmentCount: number,
): BoundRoute[] {
  let byVersion = buckets.get(method);
  if (byVersion === undefined) {
    byVersion = new Map();
    buckets.set(method, byVersion);
  }
  let bySegmentCount = byVersion.get(version);
  if (bySegmentCount === undefined) {
    bySegmentCount = [];
    byVersion.set(version, bySegmentCount);
  }
  let bucket = bySegmentCount[segmentCount];
  if (bucket === undefined) {
    bucket = [...(neutralBuckets.get(method)?.[segmentCount] ?? [])];
    bySegmentCount[segmentCount] = bucket;
  }
  return bucket;
}

function addSpecificVersionRoute(
  buckets: VersionBuckets,
  neutralBuckets: MethodBuckets,
  method: string,
  version: string,
  route: BoundRoute,
): void {
  const bucket = versionBucketFor(buckets, neutralBuckets, method, version, route.pattern.segmentCount);
  const samePathNeutral = bucket.findIndex(
    candidate => candidate.neutral === true && candidate.pattern.pattern === route.pattern.pattern,
  );
  if (samePathNeutral === -1) {
    bucket.push(route);
  } else {
    bucket.splice(samePathNeutral, 0, route);
  }
}

function addNeutralRoute(
  buckets: VersionBuckets,
  neutralBuckets: MethodBuckets,
  method: string,
  route: BoundRoute,
): void {
  bucketFor(neutralBuckets, method, route.pattern.segmentCount).push(route);
  const byVersion = buckets.get(method);
  if (byVersion === undefined) {
    return;
  }
  for (const bySegmentCount of byVersion.values()) {
    let bucket = bySegmentCount[route.pattern.segmentCount];
    if (bucket === undefined) {
      bucket = [];
      bySegmentCount[route.pattern.segmentCount] = bucket;
    }
    bucket.push(route);
  }
}

function supportedBucketFor(buckets: SupportedBuckets, method: string, segmentCount: number): SupportedRoute[] {
  let bySegmentCount = buckets.get(method);
  if (bySegmentCount === undefined) {
    bySegmentCount = [];
    buckets.set(method, bySegmentCount);
  }
  let bucket = bySegmentCount[segmentCount];
  if (bucket === undefined) {
    bucket = [];
    bySegmentCount[segmentCount] = bucket;
  }
  return bucket;
}

function addSupportedRoute(
  buckets: SupportedBuckets,
  method: string,
  pattern: CompiledPattern,
  versions: readonly string[],
): void {
  const bucket = supportedBucketFor(buckets, method, pattern.segmentCount);
  const existing = bucket.find(candidate => candidate.pattern.pattern === pattern.pattern);
  if (existing === undefined) {
    bucket.push({ pattern, versions: [...versions] });
    return;
  }
  for (const version of versions) {
    if (!existing.versions.includes(version)) {
      existing.versions.push(version);
    }
  }
}

function supportedVersions(buckets: SupportedBuckets, method: string, path: string): readonly string[] | undefined {
  for (const candidate of buckets.get(method)?.[countSegments(path)] ?? []) {
    if (matchCompiled(candidate.pattern, path) !== undefined) {
      return candidate.versions;
    }
  }
  return undefined;
}

function createVersionLookup(initial: string): VersionLookup {
  const lookup = { root: { children: new Map<number, VersionTrieNode>() }, nextId: 0 };
  addKnownVersion(lookup, initial);
  return lookup;
}

function addKnownVersion(lookup: VersionLookup, version: string): void {
  let node = lookup.root;
  for (let index = 0; index < version.length; index += 1) {
    const code = version.charCodeAt(index);
    let child = node.children.get(code);
    if (child === undefined) {
      child = { children: new Map() };
      node.children.set(code, child);
    }
    node = child;
  }
  if (node.version === undefined) {
    node.version = version;
    node.id = lookup.nextId;
    lookup.nextId += 1;
  }
}

const COMMA = 44;
const DOUBLE_QUOTE = 34;
const EQUALS = 61;
const SEMICOLON = 59;
const SPACE = 32;
const TAB = 9;
const UNKNOWN_MEDIA_VERSION = '\u0000';

function unquotedIndexOf(value: string, wanted: number, start: number, end: number): number {
  let quoted = false;
  for (let index = start; index < end; index += 1) {
    const code = value.charCodeAt(index);
    if (code === DOUBLE_QUOTE) {
      quoted = !quoted;
    } else if (!quoted && code === wanted) {
      return index;
    } else if (quoted && code === 92) {
      index += 1;
    }
  }
  return end;
}

function trimStart(value: string, start: number, end: number): number {
  let trimmed = start;
  while (trimmed < end) {
    const code = value.charCodeAt(trimmed);
    if (code !== SPACE && code !== TAB) {
      break;
    }
    trimmed += 1;
  }
  return trimmed;
}

function trimEnd(value: string, start: number, end: number): number {
  let trimmed = end;
  while (trimmed > start) {
    const code = value.charCodeAt(trimmed - 1);
    if (code !== SPACE && code !== TAB) {
      break;
    }
    trimmed -= 1;
  }
  return trimmed;
}

function asciiLower(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

function equalsAsciiIgnoringCase(value: string, start: number, end: number, expected: string): boolean {
  const first = trimStart(value, start, end);
  const last = trimEnd(value, first, end);
  if (last - first !== expected.length) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (asciiLower(value.charCodeAt(first + index)) !== expected.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function unquotedValueStart(value: string, start: number, end: number): number {
  const first = trimStart(value, start, end);
  const last = trimEnd(value, first, end);
  return last - first >= 2 && value.charCodeAt(first) === DOUBLE_QUOTE && value.charCodeAt(last - 1) === DOUBLE_QUOTE
    ? first + 1
    : first;
}

function unquotedValueEnd(value: string, start: number, end: number): number {
  const first = trimStart(value, start, end);
  const last = trimEnd(value, first, end);
  return last - first >= 2 && value.charCodeAt(first) === DOUBLE_QUOTE && value.charCodeAt(last - 1) === DOUBLE_QUOTE
    ? last - 1
    : last;
}

function knownVersion(lookup: VersionLookup, value: string, start: number, end: number): VersionTrieNode | undefined {
  const first = unquotedValueStart(value, start, end);
  const last = unquotedValueEnd(value, start, end);
  let node = lookup.root;
  for (let index = first; index < last; index += 1) {
    const child = node.children.get(value.charCodeAt(index));
    if (child === undefined) {
      return undefined;
    }
    node = child;
  }
  return node.version === undefined ? undefined : node;
}

function quality(value: string, start: number, end: number): number {
  const first = unquotedValueStart(value, start, end);
  const last = unquotedValueEnd(value, start, end);
  if (first === last) {
    return 0;
  }

  const whole = value.charCodeAt(first);
  if (whole !== 48 && whole !== 49) {
    return 0;
  }
  if (first + 1 === last) {
    return whole === 49 ? 1000 : 0;
  }
  if (value.charCodeAt(first + 1) !== 46) {
    return 0;
  }

  let fraction = 0;
  let scale = 100;
  for (let index = first + 2; index < last; index += 1) {
    const digit = value.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9 || scale === 0) {
      return 0;
    }
    fraction += digit * scale;
    scale = Math.floor(scale / 10);
  }
  if (whole === 49) {
    return fraction === 0 ? 1000 : 0;
  }
  return fraction;
}

function versionInMember(
  accept: string,
  memberStart: number,
  memberEnd: number,
  key: string,
  lookup: VersionLookup,
): VersionTrieNode | null | undefined {
  let parameterStart = unquotedIndexOf(accept, SEMICOLON, memberStart, memberEnd);
  let found: VersionTrieNode | null | undefined;
  while (parameterStart < memberEnd) {
    const parameterEnd = unquotedIndexOf(accept, SEMICOLON, parameterStart + 1, memberEnd);
    const separator = unquotedIndexOf(accept, EQUALS, parameterStart + 1, parameterEnd);
    if (separator < parameterEnd && equalsAsciiIgnoringCase(accept, parameterStart + 1, separator, key)) {
      found = knownVersion(lookup, accept, separator + 1, parameterEnd) ?? null;
    }
    parameterStart = parameterEnd;
  }
  return found;
}

function qualityInMember(accept: string, memberStart: number, memberEnd: number): number {
  let parameterStart = unquotedIndexOf(accept, SEMICOLON, memberStart, memberEnd);
  let found = 1000;
  while (parameterStart < memberEnd) {
    const parameterEnd = unquotedIndexOf(accept, SEMICOLON, parameterStart + 1, memberEnd);
    const separator = unquotedIndexOf(accept, EQUALS, parameterStart + 1, parameterEnd);
    if (separator < parameterEnd && equalsAsciiIgnoringCase(accept, parameterStart + 1, separator, 'q')) {
      found = quality(accept, separator + 1, parameterEnd);
    }
    parameterStart = parameterEnd;
  }
  return found;
}

function isProhibited(accept: string, key: string, lookup: VersionLookup, versionId: number): boolean {
  let memberStart = 0;
  while (memberStart <= accept.length) {
    const memberEnd = unquotedIndexOf(accept, COMMA, memberStart, accept.length);
    const version = versionInMember(accept, memberStart, memberEnd, key, lookup);
    if (version?.id === versionId && qualityInMember(accept, memberStart, memberEnd) === 0) {
      return true;
    }
    if (memberEnd === accept.length) {
      return false;
    }
    memberStart = memberEnd + 1;
  }
  return false;
}

function mediaTypeVersion(accept: string | undefined, key: string, fallback: string, lookup: VersionLookup): string {
  if (accept === undefined) {
    return fallback;
  }

  const onlyMemberEnd = unquotedIndexOf(accept, COMMA, 0, accept.length);
  if (onlyMemberEnd === accept.length) {
    const onlyVersion = versionInMember(accept, 0, onlyMemberEnd, key, lookup);
    if (onlyVersion === undefined) {
      return fallback;
    }
    if (onlyVersion === null || onlyVersion.version === undefined) {
      return UNKNOWN_MEDIA_VERSION;
    }
    return qualityInMember(accept, 0, onlyMemberEnd) === 0 ? UNKNOWN_MEDIA_VERSION : onlyVersion.version;
  }

  let memberStart = 0;
  let named = false;
  let best: string | undefined;
  let bestQuality = -1;
  while (memberStart <= accept.length) {
    const memberEnd = unquotedIndexOf(accept, COMMA, memberStart, accept.length);
    const version = versionInMember(accept, memberStart, memberEnd, key, lookup);
    if (version !== undefined) {
      named = true;
      const memberQuality = qualityInMember(accept, memberStart, memberEnd);
      if (
        version !== null &&
        version.version !== undefined &&
        version.id !== undefined &&
        memberQuality > bestQuality &&
        memberQuality > 0 &&
        !isProhibited(accept, key, lookup, version.id)
      ) {
        best = version.version;
        bestQuality = memberQuality;
      }
    }
    if (memberEnd === accept.length) {
      break;
    }
    memberStart = memberEnd + 1;
  }

  return best ?? (named ? UNKNOWN_MEDIA_VERSION : fallback);
}

function mediaTypeVersionLabel(accept: string | undefined, key: string): string {
  if (accept === undefined) {
    return '';
  }
  let memberStart = 0;
  let selectedStart = 0;
  let selectedEnd = 0;
  let bestQuality = -1;
  while (memberStart <= accept.length) {
    const memberEnd = unquotedIndexOf(accept, COMMA, memberStart, accept.length);
    let parameterStart = unquotedIndexOf(accept, SEMICOLON, memberStart, memberEnd);
    while (parameterStart < memberEnd) {
      const parameterEnd = unquotedIndexOf(accept, SEMICOLON, parameterStart + 1, memberEnd);
      const separator = unquotedIndexOf(accept, EQUALS, parameterStart + 1, parameterEnd);
      if (separator < parameterEnd && equalsAsciiIgnoringCase(accept, parameterStart + 1, separator, key)) {
        const memberQuality = qualityInMember(accept, memberStart, memberEnd);
        if (memberQuality > bestQuality) {
          selectedStart = unquotedValueStart(accept, separator + 1, parameterEnd);
          selectedEnd = unquotedValueEnd(accept, separator + 1, parameterEnd);
          bestQuality = memberQuality;
        }
      }
      parameterStart = parameterEnd;
    }
    if (memberEnd === accept.length) {
      break;
    }
    memberStart = memberEnd + 1;
  }
  return accept.slice(selectedStart, selectedEnd);
}

function requestedVersion(
  strategy: Exclude<VersionStrategy, { readonly kind: 'path' }>,
  headers: Readonly<Record<string, string>>,
  headerName: string | undefined,
  mediaTypeKey: string | undefined,
  mediaLookup: VersionLookup | undefined,
): string {
  if (strategy.kind === 'header') {
    return headers[headerName ?? strategy.name] ?? strategy.default;
  }
  return mediaLookup === undefined
    ? strategy.default
    : mediaTypeVersion(headers.accept, mediaTypeKey ?? strategy.key, strategy.default, mediaLookup);
}

function unsupportedVersion(
  strategy: Exclude<VersionStrategy, { readonly kind: 'path' }>,
  requested: string,
  supported: readonly string[],
  headers: Readonly<Record<string, string>>,
  mediaTypeKey: string | undefined,
): WebResponse {
  const value =
    strategy.kind === 'media-type' && requested === UNKNOWN_MEDIA_VERSION
      ? mediaTypeVersionLabel(headers.accept, mediaTypeKey ?? strategy.key)
      : requested;
  return jsonResponse(strategy.kind === 'header' ? 400 : 406, {
    error: `unsupported version "${value}"`,
    supported,
  });
}

function mediaVersionedResponse(
  response: WebResponse,
  versionHeaders: Readonly<Record<string, string>> | undefined,
): WebResponse {
  if (versionHeaders === undefined) {
    return response;
  }
  const contentType = response.headers['content-type'];
  if (contentType === undefined || !contentType.toLowerCase().startsWith('application/json')) {
    return response;
  }
  if (response.headers === versionHeaders) {
    return response;
  }
  return { ...response, headers: { ...response.headers, ...versionHeaders } };
}

const JSON_HEADERS: Readonly<Record<string, string>> = { 'content-type': 'application/json' };
const TEXT_HEADERS: Readonly<Record<string, string>> = { 'content-type': 'text/plain; charset=utf-8' };
const NO_HEADERS: Readonly<Record<string, string>> = {};
const TEXT_BODY_KIND = 'text';
const EMPTY_TEXT: ResponseBody = Object.freeze({ kind: 'text', value: '' });
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const STANDARD_HTTP_METHODS = new Set(['CONNECT', 'DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'TRACE']);

function getHeader(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }
  return undefined;
}

function jsonResponse(
  status: number,
  value: unknown,
  headers: Readonly<Record<string, string>> = JSON_HEADERS,
): WebResponse {
  return { status, body: textBody(JSON.stringify(value) ?? ''), headers };
}
}

function textBody(value: string): ResponseBody {
  return value.length === 0 ? EMPTY_TEXT : { kind: 'text', value };
}

function resolveSecurityHeaders(options?: SecurityHeadersOptions | boolean): Record<string, string> {
  if (!options) return {};
  const opts: SecurityHeadersOptions = typeof options === 'object' ? options : {};
  const headers: Record<string, string> = {};

  if (opts.xContentTypeOptions !== false) {
    headers['x-content-type-options'] =
      typeof opts.xContentTypeOptions === 'string' ? opts.xContentTypeOptions : 'nosniff';
  }
  if (opts.xFrameOptions !== false) {
    headers['x-frame-options'] = typeof opts.xFrameOptions === 'string' ? opts.xFrameOptions : 'SAMEORIGIN';
  }
  if (opts.xXssProtection !== false) {
    headers['x-xss-protection'] = typeof opts.xXssProtection === 'string' ? opts.xXssProtection : '0';
  }
  if (opts.referrerPolicy !== false) {
    headers['referrer-policy'] = typeof opts.referrerPolicy === 'string' ? opts.referrerPolicy : 'no-referrer';
  }
  if (opts.strictTransportSecurity) {
    headers['strict-transport-security'] =
      typeof opts.strictTransportSecurity === 'string'
        ? opts.strictTransportSecurity
        : 'max-age=15552000; includeSubDomains';
  }
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      headers[k.toLowerCase()] = v;
    }
  }
  return headers;
}

function resolveCorsHeaders(
  corsOptions: CorsOptions | boolean | undefined,
  req: WebRequest,
  isPreflight: boolean,
): Record<string, string> {
  if (!corsOptions) return {};
  const opts: CorsOptions = typeof corsOptions === 'object' ? corsOptions : {};
  const headers: Record<string, string> = {};
  const reqOrigin = getHeader(req.headers, 'origin');

  let allowOrigin: string | undefined;
  let varyOrigin = false;

  if (opts.origin === undefined || opts.origin === true) {
    if (opts.credentials && reqOrigin) {
      allowOrigin = reqOrigin;
      varyOrigin = true;
    } else {
      allowOrigin = '*';
    }
  } else if (typeof opts.origin === 'string') {
    allowOrigin = opts.origin;
    if (allowOrigin !== '*') {
      varyOrigin = true;
    }
  } else if (Array.isArray(opts.origin)) {
    if (reqOrigin && opts.origin.includes(reqOrigin)) {
      allowOrigin = reqOrigin;
    } else if (opts.origin.length > 0) {
      allowOrigin = opts.origin[0];
    }
    varyOrigin = true;
  } else if (typeof opts.origin === 'function') {
    const res = opts.origin(reqOrigin ?? '');
    if (res === true) {
      allowOrigin = reqOrigin;
      varyOrigin = true;
    } else if (typeof res === 'string') {
      allowOrigin = res;
      varyOrigin = true;
    }
  }

  if (allowOrigin !== undefined) {
    headers['access-control-allow-origin'] = allowOrigin;
  }
  if (varyOrigin) {
    headers['vary'] = 'Origin';
  }

  if (opts.credentials) {
    headers['access-control-allow-credentials'] = 'true';
  }

  if (isPreflight) {
    if (opts.methods) {
      headers['access-control-allow-methods'] =
        typeof opts.methods === 'string' ? opts.methods : opts.methods.join(', ');
    } else {
      headers['access-control-allow-methods'] = 'GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS';
    }

    if (opts.allowedHeaders) {
      headers['access-control-allow-headers'] =
        typeof opts.allowedHeaders === 'string' ? opts.allowedHeaders : opts.allowedHeaders.join(', ');
    } else {
      const reqHeaders = getHeader(req.headers, 'access-control-request-headers');
      headers['access-control-allow-headers'] = reqHeaders ?? 'Content-Type, Authorization';
    }

    if (typeof opts.maxAge === 'number') {
      headers['access-control-max-age'] = String(opts.maxAge);
    }
  } else {
    if (opts.exposedHeaders) {
      headers['access-control-expose-headers'] =
        typeof opts.exposedHeaders === 'string' ? opts.exposedHeaders : opts.exposedHeaders.join(', ');
    }
  }

  return headers;
}

function isWebResponse(val: unknown): val is WebResponse {
  return (
    typeof val === 'object' &&
    val !== null &&
    'status' in val &&
    typeof (val as WebResponse).status === 'number' &&
    'body' in val &&
    typeof (val as WebResponse).body === 'string' &&
    'headers' in val &&
    typeof (val as WebResponse).headers === 'object'
  );
}

function buildResponse(
  status: number,
  body: unknown,
  req: WebRequest,
  routerOptions?: RouterOptions,
  customHeaders?: Readonly<Record<string, string>>,
  isJson: boolean = true,
): WebResponse {
  const securityHeaders = resolveSecurityHeaders(routerOptions?.security);
  const corsHeaders = resolveCorsHeaders(
    routerOptions?.cors,
    req,
    status === 204 && req.method.toUpperCase() === 'OPTIONS',
  );

  const headers: Record<string, string> = {
    ...(isJson ? { 'content-type': 'application/json' } : {}),
    ...securityHeaders,
    ...corsHeaders,
  };

  if (customHeaders) {
    for (const [k, v] of Object.entries(customHeaders)) {
      headers[k.toLowerCase()] = v;
    }
  }

  const responseBody = isJson && typeof body !== 'string' ? JSON.stringify(body) : (body as string);

  return {
    status,
    body: responseBody,
    headers,
  };
}

// ---- Handler-controlled responses ------------------------------------------
//
// A handler normally returns a plain value and the pipeline serializes it as
// `200 application/json`. That covers a JSON API and nothing else: until these
// factories existed a handler could not choose a status, set a header, or return
// a body that was not JSON, so anything needing one of those had to be done in a
// hand-written adapter outside the framework.
//
// Detection is a marker symbol, deliberately not a structural check. Sniffing
// for a `status` property would be cheaper and needs no new API, but a DTO with
// a `status` field is an entirely ordinary thing to return — `{ status: 'draft' }`
// would silently stop being a body and become an HTTP status. The symbol makes
// "plain object → 200 JSON" provably unchanged for every existing caller.
//
// Symbol.for, not a fresh Symbol: two copies of this package in one process
// (a hoisting mismatch, or an app importing both `@zmdb/web` and `zmdb/web`)
// must still recognise each other's responses.
const RESPONSE_TAG = Symbol.for('zmdb.web.response');

/** Status and headers a response factory accepts. */
export interface ResponseOptions {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Options for a streamed response. */
export interface StreamOptions extends ResponseOptions {
  readonly length?: number;
  readonly onError: (error: unknown) => void;
}

/** Options for a response streamed from a known file path. */
export interface FileResponseOptions extends ResponseOptions {
  readonly contentType?: string;
  readonly onError: (error: unknown) => void;
}

// The tag is non-enumerable so a WebResponse remains the plain
// `{ status, body, headers }` record consumers expect at the top level.
function tagged(response: WebResponse): WebResponse {
  Object.defineProperty(response, RESPONSE_TAG, { value: true, enumerable: false });
  return response;
}

function isTaggedResponse(value: unknown): value is WebResponse {
  return typeof value === 'object' && value !== null && RESPONSE_TAG in value;
}

/**
 * A JSON response with an explicit status and/or extra headers.
 *
 * `return json(created, { status: 201, headers: { location } })`
 */
export function json(value: unknown, options: ResponseOptions = {}): WebResponse {
  return tagged({
    status: options.status ?? 200,
    body: textBody(JSON.stringify(value) ?? ''),
    headers: options.headers === undefined ? JSON_HEADERS : { ...JSON_HEADERS, ...options.headers },
  });
}

/**
 * A `text/plain` response, returned byte-for-byte as given.
 *
 * `return text(ctx.params.id)`
 */
export function text(body: string, options: ResponseOptions = {}): WebResponse {
  return tagged({
    status: options.status ?? 200,
    body: textBody(body),
    headers: options.headers === undefined ? TEXT_HEADERS : { ...TEXT_HEADERS, ...options.headers },
  });
}

/**
 * A response with full control and no assumed content type — for HTML, CSV, a
 * redirect, or a `204` with no body. Nothing is added to `headers`, so set
 * `content-type` yourself if the body has one.
 *
 * `return respond({ status: 302, headers: { location: '/login' } })`
 */
export function respond(init: {
  readonly status?: number;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}): WebResponse {
  return tagged({ status: init.status ?? 200, body: textBody(init.body ?? ''), headers: init.headers ?? NO_HEADERS });
}

/** A byte response with no implicit content type. */
export function bytes(value: Uint8Array<ArrayBuffer>, options: ResponseOptions = {}): WebResponse {
  return tagged({
    status: options.status ?? 200,
    body: { kind: 'bytes', value },
    headers: options.headers ?? NO_HEADERS,
  });
}

/** A streaming response whose failures are reported exactly once. */
export function stream(value: ReadableStream<Uint8Array<ArrayBuffer>>, options: StreamOptions): WebResponse {
  if (options.length !== undefined && (!Number.isSafeInteger(options.length) || options.length < 0)) {
    throw new RangeError('length must be a non-negative safe integer');
  }
  return tagged({
    status: options.status ?? 200,
    body: {
      kind: 'stream',
      value: reportingStream(value, options.length, options.onError),
      length: options.length,
    },
    headers: options.headers ?? NO_HEADERS,
  });
}

/** Stream one known file path. Path confinement belongs to the static-file handler. */
export async function file(path: string, options: FileResponseOptions): Promise<WebResponse> {
  let handle: FileHandle | undefined;
  try {
    const { open } = await import('node:fs/promises');
    handle = await open(path, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error(`not a file: ${path}`);
    }
    const body = fileHandleStream(handle);
    const headers =
      options.contentType === undefined ? options.headers : { ...options.headers, 'content-type': options.contentType };
    return stream(body, {
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(headers === undefined ? {} : { headers }),
      length: stat.size,
      onError: options.onError,
    });
  } catch (error) {
    await handle?.close().catch(() => undefined);
    options.onError(error);
    throw error;
  }
}

/** Decode a response body for assertions and other in-process consumers. */
export async function bodyText(response: WebResponse): Promise<string> {
  switch (response.body.kind) {
    case TEXT_BODY_KIND:
      return response.body.value;
    case 'bytes':
      return new TextDecoder().decode(response.body.value);
    case 'stream':
      return new Response(response.body.value).text();
  }
}

function reportingStream(
  source: ReadableStream<Uint8Array<ArrayBuffer>>,
  expectedLength: number | undefined,
  onError: (error: unknown) => void,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  const reader = source.getReader();
  let reported = false;
  let received = 0;
  const report = (error: unknown): void => {
    if (!reported) {
      reported = true;
      onError(error);
    }
  };
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          if (expectedLength !== undefined && received !== expectedLength) {
            throw new Error(
              `stream length mismatch: expected ${String(expectedLength)} bytes, received ${String(received)}`,
            );
          }
          controller.close();
          return;
        }
        received += next.value.byteLength;
        if (expectedLength !== undefined && received > expectedLength) {
          throw new Error(
            `stream length mismatch: expected ${String(expectedLength)} bytes, received at least ${String(received)}`,
          );
        }
        controller.enqueue(next.value);
      } catch (error) {
        report(error);
        void reader.cancel(error).catch(report);
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch (error) {
        report(error);
        throw error;
      }
    },
  });
}

function fileHandleStream(handle: FileHandle): ReadableStream<Uint8Array<ArrayBuffer>> {
  let closed = false;
  const close = async (): Promise<void> => {
    if (!closed) {
      closed = true;
      await handle.close();
    }
  };
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        const chunk = new Uint8Array(64 * 1024);
        const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
        if (bytesRead === 0) {
          await close();
          controller.close();
          return;
        }
        controller.enqueue(chunk.slice(0, bytesRead));
      } catch (error) {
        await close().catch(() => undefined);
        controller.error(error);
      }
    },
    cancel: close,
  });
}

export interface Router {
  register(controller: object, options?: Readonly<Record<string, RouteOptions>>): void;
  registerContract(
    contract: CompiledHttpContract,
    controllers: readonly object[],
    options?: Readonly<Record<string, Readonly<Record<string, RouteOptions>>>>,
  ): void;
  registerDeferred(controller: Constructor<object>, instance: () => Promise<object>): void;
  handle(req: WebRequest): Promise<WebResponse>;
}

/** Create a router. Routes and their effective guards are resolved once at register time. */
export function createRouter(routerOptions: RouterOptions = {}): Router {
  const buckets: MethodBuckets = new Map();
  const versioning = routerOptions.versioning;
  const requestVersioning = versioning?.kind === 'header' || versioning?.kind === 'media-type' ? versioning : undefined;
  const versionBuckets: VersionBuckets = new Map();
  const neutralBuckets: MethodBuckets = new Map();
  const supportedBuckets: SupportedBuckets = new Map();
  const versionedRouteKeys = new Set<string>();
  const registeredOperationIds = new Set<string>();
  const versionHeaderName = versioning?.kind === 'header' ? versioning.name.toLowerCase() : undefined;
  const mediaTypeKey = versioning?.kind === 'media-type' ? versioning.key.toLowerCase() : undefined;
  const mediaVersionLookup = versioning?.kind === 'media-type' ? createVersionLookup(versioning.default) : undefined;
  const tracer = routerOptions.tracer;
  const requestDuration = routerOptions.meter?.histogram('http.server.request.duration', 's');
  // One stable branch protects the original request path. A comments-only
  // configuration does not activate spans or metrics.
  const observed = tracer === undefined && requestDuration === undefined ? undefined : true;

  function claimVersionedRoute(
    controller: ControllerCtor,
    route: ResolvedRoute,
    version: string,
    publicPath: string,
  ): void {
    const key = `${route.method}\u0000${version}\u0000${publicPath}`;
    if (versionedRouteKeys.has(key)) {
      throw new Error(
        `Version registration error at ${controller.name}.${route.handlerName}: ` +
          `${route.method} ${publicPath} is already registered for version "${version}"`,
      );
    }
    versionedRouteKeys.add(key);
  }

  function addBoundRoute(
    controller: ControllerCtor,
    route: ResolvedRoute,
    handler: Handler,
    validateBody: ((raw: unknown) => unknown) | undefined,
    guards: readonly Guard[],
  ): void {
    const declaration = versionsOf(controller, route.handlerName);

    if (versioning === undefined) {
      if (declaration !== undefined && declaration !== 'neutral') {
        throw new Error(
          `Version registration error at ${controller.name}.${route.handlerName}: ` +
            '@Version() requires createRouter({ versioning: ... })',
        );
      }
      const pattern = compilePattern(route.path);
      bucketFor(buckets, route.method, pattern.segmentCount).push({
        route,
        pattern,
        handler,
        ...(validateBody === undefined ? {} : { validateBody }),
        ...(guards.length === 0 ? {} : { guards }),
      });
      return;
    }

    if (declaration === undefined) {
      throw new Error(
        `Version registration error at ${controller.name}.${route.handlerName}: ` +
          'declare @Version(...) or @VersionNeutral()',
      );
    }

    if (versioning.kind === 'path') {
      if (declaration === 'neutral') {
        const pattern = compilePattern(route.path);
        bucketFor(buckets, route.method, pattern.segmentCount).push({
          route,
          pattern,
          handler,
          ...(validateBody === undefined ? {} : { validateBody }),
          ...(guards.length === 0 ? {} : { guards }),
        });
        return;
      }
      for (const version of declaration) {
        const publicPath = pathForVersion(versioning.prefix, version, route.path);
        claimVersionedRoute(controller, route, version, publicPath);
        const expanded = { ...route, path: publicPath };
        const pattern = compilePattern(publicPath);
        bucketFor(buckets, route.method, pattern.segmentCount).push({
          route: expanded,
          pattern,
          handler,
          ...(validateBody === undefined ? {} : { validateBody }),
          ...(guards.length === 0 ? {} : { guards }),
        });
      }
      return;
    }

    const pattern = compilePattern(route.path);
    const base = {
      route,
      pattern,
      handler,
      ...(validateBody === undefined ? {} : { validateBody }),
      ...(guards.length === 0 ? {} : { guards }),
    };
    if (declaration === 'neutral') {
      addNeutralRoute(versionBuckets, neutralBuckets, route.method, { ...base, neutral: true });
      return;
    }
    for (const version of declaration) {
      claimVersionedRoute(controller, route, version, route.path);
      if (mediaVersionLookup !== undefined) {
        addKnownVersion(mediaVersionLookup, version);
      }
      addSpecificVersionRoute(versionBuckets, neutralBuckets, route.method, version, {
        ...base,
        ...(versioning.kind === 'media-type'
          ? {
              versionJsonHeaders: Object.freeze({
                'content-type': jsonMediaTypeForVersion(versioning.key, version),
              }),
            }
          : {}),
      });
    }
    addSupportedRoute(supportedBuckets, route.method, pattern, declaration);
  }

  function addContractRoute(
    controller: ControllerCtor,
    operation: HttpOperationIR,
    handler: Handler,
    validateBody: ((raw: unknown) => unknown) | undefined,
    guards: readonly Guard[],
  ): void {
    const route = { method: operation.method, path: operation.path, handlerName: operation.handler };
    const pattern = compilePattern(operation.path);
    const base = {
      route,
      operation,
      pattern,
      handler,
      ...(validateBody === undefined ? {} : { validateBody }),
      ...(guards.length === 0 ? {} : { guards }),
    };

    if (operation.version.kind === 'none') {
      if (versioning !== undefined) {
        throw new Error(
          `Contract registration error at ${operation.operationId}: an unversioned operation ` +
            'cannot be registered on a versioned router',
        );
      }
      bucketFor(buckets, operation.method, pattern.segmentCount).push(base);
      return;
    }

    if (versioning === undefined) {
      throw new Error(
        `Contract registration error at ${operation.operationId}: ${operation.version.kind} versioning ` +
          'requires createRouter({ versioning: ... })',
      );
    }

    if (operation.version.kind === 'neutral') {
      if (versioning.kind === 'path') {
        bucketFor(buckets, operation.method, pattern.segmentCount).push(base);
      } else {
        addNeutralRoute(versionBuckets, neutralBuckets, operation.method, { ...base, neutral: true });
      }
      return;
    }

    if (operation.version.kind === 'path') {
      if (versioning.kind !== 'path') {
        throw new Error(
          `Contract registration error at ${operation.operationId}: contract uses path versioning, ` +
            `router uses ${versioning.kind}`,
        );
      }
      claimVersionedRoute(controller, route, operation.version.value, operation.path);
      bucketFor(buckets, operation.method, pattern.segmentCount).push(base);
      return;
    }

    if (versioning.kind !== operation.version.kind) {
      throw new Error(
        `Contract registration error at ${operation.operationId}: contract uses ${operation.version.kind} ` +
          `versioning, router uses ${versioning.kind}`,
      );
    }
    const contractName =
      operation.version.kind === 'header' ? operation.version.name.toLowerCase() : operation.version.key.toLowerCase();
    const routerName = versioning.kind === 'header' ? versioning.name.toLowerCase() : versioning.key.toLowerCase();
    if (contractName !== routerName || operation.version.default !== versioning.default) {
      throw new Error(
        `Contract registration error at ${operation.operationId}: router ${versioning.kind} name/default ` +
          'does not match the compiled operation',
      );
    }

    for (const version of operation.version.values) {
      claimVersionedRoute(controller, route, version, operation.path);
      if (mediaVersionLookup !== undefined) addKnownVersion(mediaVersionLookup, version);
      addSpecificVersionRoute(versionBuckets, neutralBuckets, operation.method, version, {
        ...base,
        ...(operation.version.kind === 'media-type'
          ? {
              versionJsonHeaders: Object.freeze({
                'content-type': jsonMediaTypeForVersion(operation.version.key, version),
              }),
            }
          : {}),
      });
    }
    addSupportedRoute(supportedBuckets, operation.method, pattern, operation.version.values);
  }

  async function handleObserved(req: WebRequest): Promise<WebResponse> {
    const started = Date.now();
    const method = req.method.toUpperCase();
    const methodAttribute = STANDARD_HTTP_METHODS.has(method) ? method : '_OTHER';

    // OpenTelemetry semantic conventions v1.30.0: start the SERVER span with the
    // method-only fallback name, then update it once route resolution produces the
    // low-cardinality route pattern.
    const remoteParent =
      tracer === undefined ? undefined : fromTraceContext(req.headers.traceparent, req.headers.tracestate);
    const serverSpan =
      tracer === undefined
        ? undefined
        : remoteParent === undefined
          ? tracer.startSpan(method, { kind: 'server' })
          : tracer.startSpan(method, { kind: 'server', parent: remoteParent });
    try {
      if (serverSpan !== undefined) {
        serverSpan.setAttribute('http.request.method', methodAttribute);
        serverSpan.setAttribute('url.path', req.path);
        serverSpan.setAttribute('url.scheme', req.scheme ?? 'http');
        const address = req.headers.host;
        if (address !== undefined) {
          serverSpan.setAttribute('server.address', address);
        }
      }

      let matched: BoundRoute | undefined;
      let matchedParams: Record<string, string> | undefined;
      let requestVersion: string | undefined;
      const routeSpan = childSpan(tracer, serverSpan, 'zmdb.route');
      try {
        const segmentCount = countSegments(req.path);
        requestVersion =
          requestVersioning === undefined
            ? undefined
            : requestedVersion(requestVersioning, req.headers, versionHeaderName, mediaTypeKey, mediaVersionLookup);
        const candidates =
          requestVersion === undefined
            ? (buckets.get(method)?.[segmentCount] ?? [])
            : (versionBuckets.get(method)?.get(requestVersion)?.[segmentCount] ??
              neutralBuckets.get(method)?.[segmentCount] ??
              []);
        for (const candidate of candidates) {
          const params = matchCompiled(candidate.pattern, req.path);
          if (params !== undefined) {
            matched = candidate;
            matchedParams = params;
            break;
          }
        }
      } finally {
        routeSpan?.end();
      }

      if (serverSpan !== undefined && matched !== undefined) {
        const routePath = matched.operation?.path ?? matched.route.path;
        serverSpan.updateName(`${method} ${routePath}`);
        serverSpan.setAttribute('http.route', routePath);
      }

      let response: WebResponse | undefined;
      let failed = false;
      let failure: unknown;
      try {
        if (matched === undefined || matchedParams === undefined) {
          if (requestVersion !== undefined && requestVersioning !== undefined) {
            const supported = supportedVersions(supportedBuckets, method, req.path);
            if (supported !== undefined) {
              response = unsupportedVersion(requestVersioning, requestVersion, supported, req.headers, mediaTypeKey);
              return response;
            }
          }
          response = jsonResponse(404, { error: `no route for ${method} ${req.path}` });
          return response;
        }

        const ctx = {
          params: matchedParams,
          body: req.rawBody,
          query: req.query ?? {},
          headers: req.headers,
          method,
          path: req.path,
        };

        for (const guard of matched.guards ?? []) {
          try {
            if (!(await guard.canActivate(ctx))) {
              response = jsonResponse(403, { error: 'forbidden' });
              return response;
            }
          } catch (error) {
            failed = true;
            failure = error;
            response = jsonResponse(500, { error: messageOf(error) });
            return response;
          }
        }

        if (matched.validateBody !== undefined) {
          const validationSpan = childSpan(tracer, serverSpan, 'zmdb.validate');
          try {
            ctx.body = matched.validateBody(req.rawBody);
          } catch (error) {
            failed = true;
            failure = error;
            recordFailure(validationSpan, error);
            const message = messageOf(error);
            const issues = validationIssuesOf(error);
            response = jsonResponse(400, issues ? { error: message, issues } : { error: message });
            return response;
          } finally {
            validationSpan?.end();
          }
        }

        const handlerSpan = childSpan(tracer, serverSpan, 'zmdb.handler');
        const handlerCtx = handlerSpan === undefined ? ctx : { ...ctx, span: handlerSpan };
        try {
          const result = await matched.handler(handlerCtx);
          response = mediaVersionedResponse(
            isTaggedResponse(result) ? result : jsonResponse(200, result, matched.versionJsonHeaders ?? JSON_HEADERS),
            matched.versionJsonHeaders,
          );
          return response;
        } catch (error) {
          failed = true;
          failure = error;
          recordFailure(handlerSpan, error);
          if (error instanceof BoundaryStatusError) {
            response = jsonResponse(error.status, { error: error.message });
            return response;
          }
          if (error instanceof ValidationError || claimsValidationIssues(error)) {
            const message = messageOf(error);
            const issues = validationIssuesOf(error);
            response = jsonResponse(400, issues ? { error: message, issues } : { error: message });
            return response;
          }
          response = jsonResponse(500, { error: messageOf(error) });
          return response;
        } finally {
          handlerSpan?.end();
        }
      } finally {
        if (response !== undefined) {
          const serverFailed = response.status >= 500;
          const errorType = serverFailed ? (failed ? typeOfFailure(failure) : String(response.status)) : undefined;
          if (serverSpan !== undefined) {
            serverSpan.setAttribute('http.response.status_code', response.status);
            if (errorType !== undefined) {
              serverSpan.setAttribute('error.type', errorType);
              serverSpan.setStatus({ error: true });
            }
            if (serverFailed && failed) {
              serverSpan.recordException(errorValue(failure));
            }
          }
          if (requestDuration !== undefined) {
            const attributes: Record<string, string | number | boolean> = {
              'http.request.method': methodAttribute,
              'http.response.status_code': response.status,
            };
            if (matched !== undefined) {
              attributes['http.route'] = matched.operation?.path ?? matched.route.path;
            }
            if (errorType !== undefined) {
              attributes['error.type'] = errorType;
            }
            requestDuration.record((Date.now() - started) / 1000, attributes);
          }
        }
      }
    } finally {
      serverSpan?.end();
    }
  }

  return {
    register(controller: object, options: Readonly<Record<string, RouteOptions>> = {}): void {
      const ctor = controllerCtor(controller);
      if (ctor === undefined) {
        return;
      }
      for (const route of getRoutes(ctor)) {
        const handler = readHandler(controller, route.handlerName);
        if (handler === undefined) {
          continue;
        }
        const opts = options[route.handlerName];
        const routeGuards = opts?.guards ?? [];
        const publicRoute = isPublic(ctor, route.handlerName);
        if (publicRoute && (routeGuards.length > 0 || (opts?.security !== undefined && opts.security.length > 0))) {
          throw new Error(
            `Guard configuration error at ${ctor.name}.${route.handlerName}: an @Public() route cannot declare route guards or a non-empty security requirement`,
          );
        }
        const guards = publicRoute ? [] : resolveGuards(routerOptions.guardRegistry, ctor.name, routeGuards);
        addBoundRoute(ctor, route, handler, opts?.validateBody, guards);
      }
    },

    registerContract(
      contract: CompiledHttpContract,
      controllers: readonly object[],
      options: Readonly<Record<string, Readonly<Record<string, RouteOptions>>>> = {},
    ): void {
      if (contract.ir.format !== 1) {
        throw new Error(`Contract registration error: unsupported HttpContractIR format ${String(contract.ir.format)}`);
      }

      const instances = new Map<ControllerCtor, object>();
      for (const controller of controllers) {
        const ctor = controllerCtor(controller);
        if (ctor === undefined) continue;
        if (instances.has(ctor)) {
          throw new Error(`Contract registration error: more than one instance of ${ctor.name} was supplied`);
        }
        instances.set(ctor, controller);
      }

      for (const binding of contract.operations) {
        const operation = binding.operation;
        if (!contract.ir.operations.includes(operation)) {
          throw new Error(
            `Contract registration error at ${operation.operationId}: runtime binding does not reference an operation in the IR`,
          );
        }
        if (registeredOperationIds.has(operation.operationId)) {
          throw new Error(`Contract registration error at ${operation.operationId}: operation is already registered`);
        }
        const controller = instances.get(binding.controller);
        if (controller === undefined) {
          throw new Error(
            `Contract registration error at ${operation.operationId}: no ${binding.controller.name} instance was supplied`,
          );
        }
        const handler = readHandler(controller, binding.handler);
        if (handler === undefined) {
          throw new Error(
            `Contract registration error at ${operation.operationId}: ` +
              `${binding.controller.name}.${binding.handler} is not callable`,
          );
        }

        const decorated = getRoutes(binding.controller).find(
          route => route.handlerName === binding.handler && route.method === operation.method,
        );
        if (decorated === undefined) {
          throw new Error(
            `Contract registration error at ${operation.operationId}: decorator route is missing or uses another method`,
          );
        }
        const expectedPath =
          operation.version.kind === 'path' && versioning?.kind === 'path'
            ? pathForVersion(versioning.prefix, operation.version.value, decorated.path)
            : decorated.path;
        if (expectedPath !== operation.path) {
          throw new Error(
            `Contract registration error at ${operation.operationId}: compiled path ${operation.path} ` +
              `does not match decorator path ${expectedPath}`,
          );
        }

        const opts = options[operation.controller]?.[operation.handler];
        if ((opts?.deprecated === true) !== operation.deprecated) {
          throw new Error(
            `Contract registration error at ${operation.operationId}: RouteOptions.deprecated disagrees with the contract`,
          );
        }

        const routeGuards = opts?.guards ?? [];
        const publicRoute = isPublic(binding.controller, binding.handler);
        if (publicRoute && (routeGuards.length > 0 || (opts?.security !== undefined && opts.security.length > 0))) {
          throw new Error(
            `Guard configuration error at ${operation.controller}.${operation.handler}: ` +
              'an @Public() route cannot declare route guards or a non-empty security requirement',
          );
        }
        const guards = publicRoute ? [] : resolveGuards(routerOptions.guardRegistry, operation.controller, routeGuards);
        const configuredSecurity = publicRoute ? [] : (opts?.security ?? securityFromGuards(guards));
        if (publicRoute !== (operation.security.length === 0)) {
          throw new Error(
            `Contract registration error at ${operation.operationId}: @Public() and contract security disagree`,
          );
        }
        if (!publicRoute && guards.length === 0) {
          throw new Error(
            `Contract registration error at ${operation.operationId}: a protected operation has no runtime guard`,
          );
        }
        if (configuredSecurity === undefined || !sameSecurity(configuredSecurity, operation.security)) {
          throw new Error(
            `Contract registration error at ${operation.operationId}: effective runtime security disagrees with the contract`,
          );
        }
        addContractRoute(binding.controller, operation, handler, opts?.validateBody, guards);
        registeredOperationIds.add(operation.operationId);
      }
    },

    registerDeferred(controller: Constructor<object>, instance: () => Promise<object>): void {
      for (const route of getRoutes(controller)) {
        let resolved: Handler | undefined;
        const handler: Handler = async ctx => {
          if (resolved === undefined) {
            const built = await instance();
            resolved = readHandler(built, route.handlerName);
            if (resolved === undefined) {
              throw new Error(`@zmdb/web: controller has no handler named "${route.handlerName}"`);
            }
          }
          return resolved(ctx);
        };
        const guards = isPublic(controller, route.handlerName)
          ? []
          : resolveGuards(routerOptions.guardRegistry, controller.name);
        addBoundRoute(controller, route, handler, undefined, guards);
      }
    },

    async handle(req: WebRequest): Promise<WebResponse> {
      if (observed !== undefined) {
        return handleObserved(req);
      }
      const method = req.method.toUpperCase();
      if (method === 'OPTIONS' && (routerOptions?.cors !== undefined || routerOptions?.security !== undefined)) {
        return buildResponse(204, '', req, routerOptions, undefined, false);
      }

      const segmentCount = countSegments(req.path);
      const requestVersion =
        requestVersioning === undefined
          ? undefined
          : requestedVersion(requestVersioning, req.headers, versionHeaderName, mediaTypeKey, mediaVersionLookup);
      const candidates =
        requestVersion === undefined
          ? (buckets.get(method)?.[segmentCount] ?? [])
          : (versionBuckets.get(method)?.get(requestVersion)?.[segmentCount] ??
            neutralBuckets.get(method)?.[segmentCount] ??
            []);
      for (const bound of candidates) {
        const params = matchCompiled(bound.pattern, req.path);
        if (params === undefined) {
          continue;
        }
        const ctx = {
          params,
          body: req.rawBody,
          query: req.query ?? {},
          headers: req.headers,
          method,
          path: req.path,
        };
        for (const guard of bound.guards ?? []) {
          try {
            if (!(await guard.canActivate(ctx))) {
              return jsonResponse(403, { error: 'forbidden' });
            }
          } catch (error) {
            return jsonResponse(500, { error: messageOf(error) });
          }
        }

        if (bound.validateBody !== undefined) {
          try {
            ctx.body = bound.validateBody(req.rawBody);
          } catch (error) {
            const message = messageOf(error);
            const issues = validationIssuesOf(error);
            return buildResponse(400, issues ? { error: message, issues } : { error: message }, req, routerOptions);
          }
        }
        try {
          const result = await bound.handler(ctx);
          if (isTaggedResponse(result) || isWebResponse(result)) {
            if (!routerOptions?.security && !routerOptions?.cors) {
              return mediaVersionedResponse(result, bound.versionJsonHeaders);
            }
            const securityHeaders = resolveSecurityHeaders(routerOptions?.security);
            const corsHeaders = resolveCorsHeaders(routerOptions?.cors, req, false);
            const mergedHeaders: Record<string, string> = {
              ...securityHeaders,
              ...corsHeaders,
            };
            for (const [k, v] of Object.entries(result.headers)) {
              mergedHeaders[k.toLowerCase()] = v;
            }
            return mediaVersionedResponse(
              {
                status: result.status,
                body: result.body,
                headers: mergedHeaders,
              },
              bound.versionJsonHeaders,
            );
          }
          return mediaVersionedResponse(
            buildResponse(200, result, req, routerOptions, bound.versionJsonHeaders),
            bound.versionJsonHeaders,
          );
        } catch (error) {
          // A framework boundary refusal keeps its selected status. A validation
          // error out of the handler is the request's fault and becomes 400;
          // anything else is 500 with its message and nothing invented.
          if (error instanceof BoundaryStatusError) {
            return jsonResponse(error.status, { error: error.message });
          }
          if (error instanceof ValidationError || claimsValidationIssues(error)) {
            const message = messageOf(error);
            const issues = validationIssuesOf(error);
            return buildResponse(400, issues ? { error: message, issues } : { error: message }, req, routerOptions);
          }
          return buildResponse(500, { error: messageOf(error) }, req, routerOptions);
        }
      }
      if (requestVersion !== undefined && requestVersioning !== undefined) {
        const supported = supportedVersions(supportedBuckets, method, req.path);
        if (supported !== undefined) {
          return unsupportedVersion(requestVersioning, requestVersion, supported, req.headers, mediaTypeKey);
        }
      }
      return buildResponse(404, { error: `no route for ${method} ${req.path}` }, req, routerOptions);
    },
  };
}

// The constructor type getRoutes reads metadata from.
type ControllerCtor = abstract new (...args: never[]) => unknown;

// boundary: an instance's `.constructor` carries the Symbol.metadata the class
// decorators wrote; narrowing it to a constructor type for getRoutes is sound.
function controllerCtor(controller: object): ControllerCtor | undefined {
  const ctor = controller.constructor;
  if (typeof ctor !== 'function') {
    return undefined;
  }
  return ctor as ControllerCtor;
}

function sameSecurity(left: readonly SecurityRequirement[], right: readonly SecurityRequirement[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((requirement, index) => {
    const expected = right[index];
    if (expected === undefined) return false;
    const names = Object.keys(requirement).toSorted();
    const expectedNames = Object.keys(expected).toSorted();
    return (
      names.length === expectedNames.length &&
      names.every((name, nameIndex) => {
        const scopes = [...(requirement[name] ?? [])].toSorted();
        const expectedScopes = [...(expected[name] ?? [])].toSorted();
        return (
          name === expectedNames[nameIndex] &&
          scopes.length === expectedScopes.length &&
          scopes.every((scope, scopeIndex) => scope === expectedScopes[scopeIndex])
        );
      })
    );
  });
}

function isSecurityAwareGuard(guard: Guard): guard is SecurityAwareGuard {
  if (!('enforces' in guard)) return false;
  const enforcement = guard.enforces;
  return (
    typeof enforcement === 'object' &&
    enforcement !== null &&
    'scheme' in enforcement &&
    typeof enforcement.scheme === 'string' &&
    'scopes' in enforcement &&
    Array.isArray(enforcement.scopes) &&
    enforcement.scopes.every(scope => typeof scope === 'string')
  );
}

function securityFromGuards(guards: readonly Guard[]): readonly SecurityRequirement[] | undefined {
  const schemes = new Map<string, Set<string>>();
  for (const guard of guards) {
    if (!isSecurityAwareGuard(guard)) continue;
    const scopes = schemes.get(guard.enforces.scheme) ?? new Set<string>();
    for (const scope of guard.enforces.scopes) scopes.add(scope);
    schemes.set(guard.enforces.scheme, scopes);
  }
  if (schemes.size === 0) return undefined;
  return [
    Object.fromEntries(
      [...schemes.entries()]
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([name, scopes]) => [name, [...scopes].toSorted()]),
    ),
  ];
}

// boundary: a controller's own decorated methods are the handlers; reading a
// method by its recorded name off the instance and treating it as a Handler is
// sound because getRoutes only yields names of methods the decorators saw. This
// is the single enumerated boundary for the pipeline (ARCHITECTURE.md §2.1).
function readHandler(controller: object, name: string): Handler | undefined {
  const value = Reflect.get(controller, name);
  if (typeof value !== 'function') {
    return undefined;
  }
  const bound = value.bind(controller);
  return bound as Handler;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function childSpan(tracer: Tracer | undefined, parent: Span | undefined, name: string): Span | undefined {
  return tracer === undefined || parent === undefined
    ? undefined
    : tracer.startSpan(name, { kind: 'internal', parent: parent.spanContext() });
}

function recordFailure(span: Span | undefined, error: unknown): void {
  if (span === undefined) {
    return;
  }
  span.recordException(errorValue(error));
  span.setStatus({ error: true });
}

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function typeOfFailure(error: unknown): string {
  if (error instanceof Error) {
    return error.constructor.name;
  }
  if (error !== null && typeof error === 'object') {
    const ctor: unknown = Reflect.get(error, 'constructor');
    if (typeof ctor === 'function' && ctor.name.length > 0) {
      return ctor.name;
    }
  }
  return typeof error;
}

// ---- Adapters (structurally typed; no hard node:http / Hono dependency) ----

// The subset of node:http we touch. `setEncoding` and `writeHead` are optional
// because this adapter is structurally typed — a hand-rolled req/res that lacks
// them still works, it just takes the slower path.
interface NodeReqLike {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly socket?: { readonly encrypted?: boolean };
  on(event: string, listener: (chunk: unknown) => void): void;
  setEncoding?(encoding: string): void;
}
interface NodeResLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  writeHead?(status: number, headers: Readonly<Record<string, string>>): unknown;
  write(chunk: Uint8Array<ArrayBuffer>): boolean;
  once(event: string, listener: () => void): void;
  destroy(error?: Error): void;
  end(body?: string | Uint8Array<ArrayBuffer>): void;
}

/** Request-body limits shared by the Node and Fetch adapters. */
export interface AdapterOptions {
  readonly maxBodyBytes: number;
}

/**
 * Adapt a router to a node:http `(req, res)` handler.
 *
 * This is the path real consumers take, so its per-request cost is the
 * framework's real cost. The benchmark harness hand-writes its responses and so
 * never measured this; when it was measured (keep-alive on, 8 workers, c=256,
 * median of 5) the adapter served 294,067 req/s against the hand-written app's
 * 395,983 — 1.35x slower, entirely in the four things below.
 */
export function toNodeHandler(
  router: Router,
  options: AdapterOptions = { maxBodyBytes: DEFAULT_MAX_BODY_BYTES },
): (req: NodeReqLike, res: NodeResLike) => void {
  validateMaxBodyBytes(options.maxBodyBytes);
  return function (req: NodeReqLike, res: NodeResLike): void {
    // A request with no body needs no 'data'/'end' listeners, no accumulator and
    // no extra event-loop turn — and per RFC 9112 a request with neither
    // content-length nor transfer-encoding HAS no body, which is the same rule
    // node:http itself uses to decide whether to emit 'data' at all. So for the
    // GET/HEAD/DELETE traffic that dominates most services this dispatches
    // straight away instead of registering two closures and waiting a tick.
    if (hasRequestBody(req)) {
      const announcedLength = requestContentLength(req);
      if (announcedLength !== undefined && announcedLength > options.maxBodyBytes) {
        rejectOversizedRequest(res);
        return;
      }
      const binary = hasBinaryContentType(req.headers['content-type']);
      let size = 0;
      let exceeded = false;
      const byteChunks: Uint8Array<ArrayBuffer>[] = [];
      let raw = '';
      // setEncoding installs a StringDecoder, which holds partial multi-byte
      // sequences across reads. Decoding each chunk separately with
      // String(chunk) — as this used to — corrupts any character whose UTF-8
      // bytes straddle a chunk boundary, so a large body with non-ASCII text
      // would silently arrive with replacement characters in it.
      if (!binary) {
        req.setEncoding?.('utf8');
      }
      req.on('data', chunk => {
        if (exceeded) {
          return;
        }
        if (binary) {
          const chunkValue = chunkBytes(chunk);
          size += chunkValue.byteLength;
          if (size <= options.maxBodyBytes) {
            byteChunks.push(chunkValue);
          }
        } else {
          const chunkValue = String(chunk);
          size += new TextEncoder().encode(chunkValue).byteLength;
          if (size <= options.maxBodyBytes) {
            raw += chunkValue;
          }
        }
        if (size > options.maxBodyBytes) {
          exceeded = true;
          rejectOversizedRequest(res);
        }
      });
      req.on('end', () => {
        if (exceeded) {
          return;
        }
        const requestBody = binary ? joinBytes(byteChunks, size) : raw.length > 0 ? parseJson(raw) : undefined;
        dispatch(router, req, res, requestBody);
      });
      return;
    }
    dispatch(router, req, res, undefined);
  };
}

// content-length: 0 is explicitly "no body"; any other length, or any
// transfer-encoding at all (chunked), means there is one to read.
function hasRequestBody(req: NodeReqLike): boolean {
  const length = req.headers['content-length'];
  if (typeof length === 'string') {
    return length !== '0';
  }
  return req.headers['transfer-encoding'] !== undefined;
}

function dispatch(router: Router, req: NodeReqLike, res: NodeResLike, rawBody: unknown): void {
  // `url.split('?')` allocated an array and split the whole query string just to
  // throw the tail away; indexOf/slice reads the path without either.
  const url = req.url ?? '/';
  const query = url.indexOf('?');
  // `.then(ok, err)` rather than an `async` IIFE with `await`: the IIFE added a
  // second async frame and a second promise to every request on top of the one
  // `router.handle` already returns. The reject arm also means a throw from
  // outside handle's own try/catch becomes a 500 instead of an unhandled
  // rejection that takes the process down.
  void router
    .handle({
      method: req.method ?? 'GET',
      path: query === -1 ? url : url.slice(0, query),
      headers: flattenHeaders(req.headers),
      rawBody,
      scheme: req.socket?.encrypted === true ? 'https' : 'http',
    })
    .then(
      response => {
        send(res, response, req.method ?? 'GET');
      },
      (error: unknown) => {
        send(res, jsonResponse(500, { error: messageOf(error) }), req.method ?? 'GET');
      },
    );
}

function send(res: NodeResLike, response: WebResponse, method: string): void {
  const noBody = method.toUpperCase() === 'HEAD' || response.status === 204 || response.status === 304;
  if (noBody) {
    if (response.body.kind === 'stream') {
      void response.body.value.cancel('response has no body').catch(() => undefined);
    }
    writeNodeHead(res, response.status, withoutFramingHeaders(response.headers));
    res.end();
    return;
  }
  switch (response.body.kind) {
    case TEXT_BODY_KIND:
      writeNodeHead(res, response.status, withoutTransferEncoding(response.headers));
      res.end(response.body.value);
      return;
    case 'bytes': {
      const headers = withContentLength(response.headers, response.body.value.byteLength);
      writeNodeHead(res, response.status, headers);
      res.end(response.body.value);
      return;
    }
    case 'stream':
      void sendNodeStream(res, response);
  }
}

function writeNodeHead(res: NodeResLike, status: number, headers: Readonly<Record<string, string>>): void {
  // One writeHead with the whole header object beats a setHeader per entry:
  // setHeader was the slowest of the five header strategies measured (78,962
  // req/s against 91,302 for writeHead with an object literal), because each
  // call re-validates the name and touches the outgoing-header map. The common
  // case also hands writeHead the shared frozen JSON_HEADERS constant, so
  // nothing is iterated or allocated at all.
  if (res.writeHead === undefined) {
    res.statusCode = status;
    for (const key of Object.keys(headers)) {
      res.setHeader(key, headers[key] ?? '');
    }
  } else {
    res.writeHead(status, headers);
  }
}

async function sendNodeStream(res: NodeResLike, response: WebResponse): Promise<void> {
  if (response.body.kind !== 'stream') {
    return;
  }
  const reader = response.body.value.getReader();
  let headersWritten = false;
  let complete = false;
  let disconnected = false;
  let markDisconnected: () => void = () => undefined;
  const disconnectedSignal = new Promise<void>(resolve => {
    markDisconnected = resolve;
  });
  res.once('close', () => {
    if (!complete) {
      disconnected = true;
      markDisconnected();
      void reader.cancel('client disconnected').catch(() => undefined);
    }
  });
  try {
    const first = await reader.read();
    if (disconnected) {
      complete = true;
      return;
    }
    const headers =
      response.body.length === undefined
        ? withoutFramingHeaders(response.headers)
        : withContentLength(response.headers, response.body.length);
    if (first.done) {
      writeNodeHead(res, response.status, headers);
      headersWritten = true;
      complete = true;
      res.end();
      return;
    }
    writeNodeHead(res, response.status, headers);
    headersWritten = true;
    if (!res.write(first.value)) {
      await Promise.race([nodeDrain(res), disconnectedSignal]);
      if (disconnected) {
        complete = true;
        return;
      }
    }
    for (;;) {
      const next = await reader.read();
      if (disconnected) {
        complete = true;
        return;
      }
      if (next.done) {
        complete = true;
        res.end();
        return;
      }
      if (!res.write(next.value)) {
        await Promise.race([nodeDrain(res), disconnectedSignal]);
        if (disconnected) {
          complete = true;
          return;
        }
      }
    }
  } catch (error) {
    complete = true;
    if (disconnected) {
      return;
    }
    if (!headersWritten) {
      send(res, jsonResponse(500, { error: messageOf(error) }), 'GET');
      return;
    }
    res.destroy(error instanceof Error ? error : new Error(String(error)));
  }
}

function nodeDrain(res: NodeResLike): Promise<void> {
  return new Promise(resolve => {
    res.once('drain', resolve);
  });
}

/** Adapt a router to a Fetch `(Request) => Promise<Response>` handler. */
export function toFetchHandler(
  router: Router,
  options: AdapterOptions = { maxBodyBytes: DEFAULT_MAX_BODY_BYTES },
): (request: Request) => Promise<Response> {
  validateMaxBodyBytes(options.maxBodyBytes);
  return async function (request: Request): Promise<Response> {
    const url = new URL(request.url);
    const raw =
      request.method === 'GET' || request.method === 'HEAD'
        ? { ok: true as const, value: undefined }
        : await readFetchBody(request, options.maxBodyBytes);
    if (!raw.ok) {
      return new Response(null, { status: 413 });
    }
    const response = await router.handle({
      method: request.method,
      path: url.pathname,
      headers: Object.fromEntries(request.headers),
      rawBody: raw.value,
      scheme: url.protocol.slice(0, -1),
    });
    const headers = fetchHeaders(response);
    if (request.method === 'HEAD' || response.status === 204 || response.status === 304) {
      if (response.body.kind === 'stream') {
        await response.body.value.cancel('response has no body').catch(() => undefined);
      }
      headers.delete('content-length');
      return new Response(null, { status: response.status, headers });
    }
    switch (response.body.kind) {
      case TEXT_BODY_KIND:
        return new Response(fetchTextBody(response.body.value, headers), { status: response.status, headers });
      case 'bytes':
        return new Response(response.body.value, { status: response.status, headers });
      case 'stream':
        return new Response(response.body.value, { status: response.status, headers });
    }
  };
}

async function readFetchBody(
  request: Request,
  maxBodyBytes: number,
): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  const announced = request.headers.get('content-length');
  if (announced !== null && Number(announced) > maxBodyBytes) {
    await request.body?.cancel('request body exceeds maxBodyBytes');
    return { ok: false };
  }
  if (request.body === null) {
    return { ok: true, value: undefined };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    size += next.value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel('request body exceeds maxBodyBytes');
      return { ok: false };
    }
    chunks.push(new Uint8Array(next.value));
  }
  const joined = joinBytes(chunks, size);
  if (joined.byteLength === 0) {
    return { ok: true, value: undefined };
  }
  if (hasBinaryContentType(request.headers.get('content-type') ?? undefined)) {
    return { ok: true, value: joined };
  }
  return { ok: true, value: parseJson(new TextDecoder().decode(joined)) };
}

function parseJson(raw: string): unknown {
  try {
    // boundary: JSON.parse yields `any`; we immediately widen to `unknown` so no
    // `any` escapes into the pipeline (validators/handlers narrow from there).
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    return raw;
  }
}

// Object.keys allocates one array; Object.entries — which this used to use —
// allocates that array plus a two-element array per header. A request with a
// dozen headers was therefore doing thirteen allocations to read six of them.
function flattenHeaders(headers: Readonly<Record<string, string | string[] | undefined>>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const key of Object.keys(headers)) {
    const value = headers[key];
    if (typeof value === 'string') {
      flat[key] = value;
    } else if (Array.isArray(value)) {
      flat[key] = value.join(', ');
    }
  }
  return flat;
}

function validateMaxBodyBytes(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('maxBodyBytes must be a positive safe integer');
  }
}

function requestContentLength(req: NodeReqLike): number | undefined {
  const value = req.headers['content-length'];
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function hasBinaryContentType(value: string | readonly string[] | undefined): boolean {
  const contentType = Array.isArray(value) ? value[0] : value;
  if (contentType === undefined) {
    return false;
  }
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return mediaType !== 'application/json' && !mediaType.endsWith('+json') && !mediaType.startsWith('text/');
}

function chunkBytes(chunk: unknown): Uint8Array<ArrayBuffer> {
  return chunk instanceof Uint8Array ? new Uint8Array(chunk) : new TextEncoder().encode(String(chunk));
}

function joinBytes(chunks: readonly Uint8Array<ArrayBuffer>[], size: number): Uint8Array<ArrayBuffer> {
  if (chunks.length === 1) {
    return chunks[0] ?? new Uint8Array();
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function rejectOversizedRequest(res: NodeResLike): void {
  send(res, jsonResponse(413, { error: 'request body exceeds maxBodyBytes' }), 'POST');
  res.destroy(new Error('request body exceeds maxBodyBytes'));
}

function withoutTransferEncoding(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return omitHeaders(headers, false);
}

function withoutFramingHeaders(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return omitHeaders(headers, true);
}

function omitHeaders(
  headers: Readonly<Record<string, string>>,
  removeContentLength: boolean,
): Readonly<Record<string, string>> {
  let found = false;
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'transfer-encoding' || (removeContentLength && lower === 'content-length')) {
      found = true;
      break;
    }
  }
  if (!found) {
    return headers;
  }
  const clean: Record<string, string> = {};
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower !== 'transfer-encoding' && (!removeContentLength || lower !== 'content-length')) {
      clean[key] = headers[key] ?? '';
    }
  }
  return clean;
}

function withContentLength(
  headers: Readonly<Record<string, string>>,
  length: number,
): Readonly<Record<string, string>> {
  return { ...withoutFramingHeaders(headers), 'content-length': String(length) };
}

function fetchHeaders(response: WebResponse): Headers {
  const headers = new Headers(withoutTransferEncoding(response.headers));
  if (response.body.kind === 'bytes') {
    headers.set('content-length', String(response.body.value.byteLength));
  } else if (response.body.kind === 'stream') {
    if (response.body.length === undefined) {
      headers.delete('content-length');
    } else {
      headers.set('content-length', String(response.body.length));
    }
  }
  return headers;
}

function fetchTextBody(value: string, headers: Headers): string | Uint8Array<ArrayBuffer> | null {
  if (value.length === 0) {
    return null;
  }
  return headers.has('content-type') ? value : new TextEncoder().encode(value);
}
