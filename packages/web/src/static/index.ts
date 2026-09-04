// @zmdb/web — confined static-file responses (epic #564, issue #568).
//
// Paths are decoded once, refused before filesystem access, opened once, and
// streamed from that descriptor. Every refusal is the same empty 404; details
// go only to the required onError sink.

import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

import { respond, stream, type WebResponse } from '../pipeline/index.js';

export interface StaticOptions {
  readonly root: string;
  readonly index?: string;
  readonly cacheControl?: string;
  readonly contentTypes?: Readonly<Record<string, string>>;
  readonly onError: (error: unknown) => void;
}

export interface StaticHandler {
  serve(pathname: string, headers: Readonly<Record<string, string>>): Promise<WebResponse>;
}

const DEFAULT_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const NOSNIFF = Object.freeze({ 'x-content-type-options': 'nosniff' });
const DEFAULT_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.mjs': 'application/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
});

interface ByteRange {
  readonly kind: 'range';
  readonly start: number;
  readonly end: number;
}

type ParsedRange = { readonly kind: 'full' } | { readonly kind: 'unsatisfiable' } | ByteRange;

interface StaticFilesystem {
  readonly open: (path: string, flags: number) => Promise<FileHandle>;
  readonly realpath: (path: string) => Promise<string>;
  readonly stat: (path: string) => Promise<Stats>;
  readonly readFlags: number;
}

interface StaticPaths {
  readonly extname: (path: string) => string;
  readonly isAbsolute: (path: string) => boolean;
  readonly resolve: (...paths: string[]) => string;
  readonly sep: string;
}

/** Build a handler whose root is resolved and validated exactly once. */
export async function createStaticHandler(options: StaticOptions): Promise<StaticHandler> {
  // Keep @zmdb/web and @zmdb/web/static loadable on Fetch-only runtimes. The
  // Node filesystem is required only when an application constructs this
  // filesystem-backed handler.
  const [fsModule, fsPromises, pathModule] = await Promise.all([
    import('node:fs'),
    import('node:fs/promises'),
    import('node:path'),
  ]);
  const filesystem: StaticFilesystem = {
    open: (path, flags) => fsPromises.open(path, flags),
    realpath: path => fsPromises.realpath(path),
    stat: path => fsPromises.stat(path),
    readFlags: fsModule.constants.O_RDONLY | fsModule.constants.O_NONBLOCK,
  };
  const paths: StaticPaths = {
    extname: pathModule.extname,
    isAbsolute: pathModule.isAbsolute,
    resolve: pathModule.resolve,
    sep: pathModule.sep,
  };

  const root = await filesystem.realpath(options.root);
  const rootStat = await filesystem.stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error('static root must be a directory');
  }

  const cacheControl = options.cacheControl ?? DEFAULT_CACHE_CONTROL;
  const contentTypes = normalizedContentTypes(options.contentTypes);

  return {
    serve(pathname: string, headers: Readonly<Record<string, string>>): Promise<WebResponse> {
      return serveFromRoot(filesystem, paths, root, pathname, headers, cacheControl, contentTypes, options);
    },
  };
}

async function serveFromRoot(
  filesystem: StaticFilesystem,
  paths: StaticPaths,
  root: string,
  pathname: string,
  requestHeaders: Readonly<Record<string, string>>,
  cacheControl: string,
  contentTypes: Readonly<Record<string, string>>,
  options: StaticOptions,
): Promise<WebResponse> {
  const relative = confinedPath(pathname, options.index, paths);
  if (relative.kind === 'missing') {
    return notFound();
  }
  if (relative.kind === 'refused') {
    report(options, relative.error);
    return notFound();
  }

  const resolved = paths.resolve(root, relative.value);
  if (!contains(root, resolved, paths.sep)) {
    report(options, new Error('static path escaped its root'));
    return notFound();
  }

  let handle: FileHandle;
  try {
    // O_NONBLOCK is load-bearing for FIFOs: opening one only to discover its
    // inode type must not wait forever for a writer.
    handle = await filesystem.open(resolved, filesystem.readFlags);
  } catch (error) {
    if (!isOrdinaryMiss(error)) {
      report(options, error);
    }
    return notFound();
  }

  try {
    const descriptorStat = await handle.stat();
    if (!descriptorStat.isFile()) {
      report(options, new Error('static path is not a regular file'));
      await closeQuietly(handle);
      return notFound();
    }

    const target = await openedRealpath(filesystem, handle, resolved, descriptorStat);
    if (!contains(root, target, paths.sep)) {
      report(options, new Error('static symlink escaped its root'));
      await closeQuietly(handle);
      return notFound();
    }

    const validators = validatorHeaders(descriptorStat, cacheControl);
    if (notModified(requestHeaders, descriptorStat, validators.etag)) {
      await closeQuietly(handle);
      return respond({ status: 304, headers: validators });
    }

    const requestedRange =
      header(requestHeaders, 'if-range') === undefined
        ? parseRange(header(requestHeaders, 'range'), descriptorStat.size)
        : { kind: 'full' as const };

    if (requestedRange.kind === 'unsatisfiable') {
      await closeQuietly(handle);
      return respond({
        status: 416,
        headers: { ...validators, 'content-range': `bytes */${String(descriptorStat.size)}` },
      });
    }

    const extension = paths.extname(relative.value).toLowerCase();
    const contentType = contentTypes[extension] ?? 'application/octet-stream';
    const start = requestedRange.kind === 'full' ? 0 : requestedRange.start;
    const end = requestedRange.kind === 'full' ? Math.max(0, descriptorStat.size - 1) : requestedRange.end;
    const length = requestedRange.kind === 'full' ? descriptorStat.size : end - start + 1;
    const responseHeaders: Record<string, string> = {
      ...validators,
      'accept-ranges': 'bytes',
      'content-length': String(length),
      'content-type': contentType,
    };
    if (requestedRange.kind !== 'full') {
      responseHeaders['content-range'] = `bytes ${String(start)}-${String(end)}/${String(descriptorStat.size)}`;
    }

    return stream(fileWindow(handle, start, length), {
      status: requestedRange.kind === 'full' ? 200 : 206,
      headers: responseHeaders,
      length,
      onError: options.onError,
    });
  } catch (error) {
    await closeQuietly(handle);
    report(options, error);
    return notFound();
  }
}

type ConfinedPath =
  | { readonly kind: 'path'; readonly value: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'refused'; readonly error: Error };

function confinedPath(pathname: string, index: string | undefined, paths: StaticPaths): ConfinedPath {
  if (pathname.length === 0 && index === undefined) {
    return { kind: 'missing' };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname.length === 0 ? (index ?? '') : pathname);
  } catch {
    return { kind: 'refused', error: new Error('static path is not valid percent-encoded UTF-8') };
  }

  if (
    decoded.length === 0 ||
    decoded.includes('%') ||
    decoded.includes('\0') ||
    decoded.includes('\\') ||
    decoded.startsWith('/') ||
    decoded.startsWith('//') ||
    /^[A-Za-z]:/.test(decoded) ||
    paths.isAbsolute(decoded)
  ) {
    return { kind: 'refused', error: new Error('static path contains a refused form') };
  }

  const segments = decoded.split('/');
  if (segments.some(segment => segment.length === 0 || segment === '..' || segment.startsWith('.'))) {
    return { kind: 'refused', error: new Error('static path contains a refused segment') };
  }

  return { kind: 'path', value: decoded };
}

function contains(root: string, candidate: string, separator: string): boolean {
  const prefix = root.endsWith(separator) ? root : `${root}${separator}`;
  return candidate === root || candidate.startsWith(prefix);
}

function normalizedContentTypes(
  overrides: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (overrides === undefined) {
    return DEFAULT_CONTENT_TYPES;
  }
  const result: Record<string, string> = { ...DEFAULT_CONTENT_TYPES };
  for (const key of Object.keys(overrides)) {
    result[key.toLowerCase()] = overrides[key] ?? 'application/octet-stream';
  }
  return result;
}

async function openedRealpath(
  filesystem: StaticFilesystem,
  handle: FileHandle,
  originalPath: string,
  descriptorStat: Stats,
): Promise<string> {
  try {
    // Linux exposes the canonical target of the descriptor itself. The frozen
    // tests already require /proc for descriptor accounting, and this form
    // closes the path-swap gap between open() and the symlink containment check.
    return await filesystem.realpath(`/proc/self/fd/${String(handle.fd)}`);
  } catch {
    // Other supported Node platforms have no portable fd-to-path API. The
    // opened descriptor still owns response metadata and bytes. Bind the
    // path-based real target back to that descriptor by filesystem identity so
    // a swap between open() and realpath() is refused.
    const target = await filesystem.realpath(originalPath);
    const targetStat = await filesystem.stat(target);
    if (!sameFile(descriptorStat, targetStat)) {
      throw new Error('static path changed while it was being opened');
    }
    return target;
  }
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function validatorHeaders(statValue: Stats, cacheControl: string): Record<string, string> & { readonly etag: string } {
  return {
    'cache-control': cacheControl,
    etag: `W/"${String(statValue.size)}-${String(statValue.mtimeMs)}"`,
    'last-modified': statValue.mtime.toUTCString(),
    'x-content-type-options': 'nosniff',
  };
}

function notModified(headers: Readonly<Record<string, string>>, statValue: Stats, etag: string): boolean {
  const ifNoneMatch = header(headers, 'if-none-match');
  if (ifNoneMatch !== undefined) {
    return ifNoneMatch
      .split(',')
      .map(value => value.trim())
      .some(value => value === '*' || weakTag(value) === weakTag(etag));
  }

  const ifModifiedSince = header(headers, 'if-modified-since');
  if (ifModifiedSince === undefined) {
    return false;
  }
  const since = Date.parse(ifModifiedSince);
  return Number.isFinite(since) && Math.floor(statValue.mtimeMs / 1000) * 1000 <= since;
}

function weakTag(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
}

function parseRange(value: string | undefined, size: number): ParsedRange {
  if (value === undefined || value.includes(',')) {
    return { kind: 'full' };
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (match === null) {
    return { kind: 'full' };
  }
  const first = match[1] ?? '';
  const second = match[2] ?? '';
  if (first.length === 0 && second.length === 0) {
    return { kind: 'full' };
  }

  if (first.length === 0) {
    const suffix = safeInteger(second);
    if (suffix === undefined || suffix <= 0 || size === 0) {
      return { kind: 'full' };
    }
    return { kind: 'range', start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = safeInteger(first);
  if (start === undefined) {
    return { kind: 'full' };
  }
  if (start >= size) {
    return { kind: 'unsatisfiable' };
  }
  if (second.length === 0) {
    return { kind: 'range', start, end: size - 1 };
  }
  const requestedEnd = safeInteger(second);
  if (requestedEnd === undefined || requestedEnd < start) {
    return { kind: 'full' };
  }
  return { kind: 'range', start, end: Math.min(requestedEnd, size - 1) };
}

function safeInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function header(headers: Readonly<Record<string, string>>, wanted: string): string | undefined {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === wanted) {
      return headers[name];
    }
  }
  return undefined;
}

function fileWindow(handle: FileHandle, start: number, length: number): ReadableStream<Uint8Array<ArrayBuffer>> {
  let position = start;
  let remaining = length;
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
        if (remaining === 0) {
          await close();
          controller.close();
          return;
        }
        const wanted = Math.min(64 * 1024, remaining);
        const chunk = new Uint8Array(wanted);
        const result = await handle.read(chunk, 0, wanted, position);
        if (result.bytesRead === 0) {
          throw new Error('static file ended before its measured length');
        }
        position += result.bytesRead;
        remaining -= result.bytesRead;
        controller.enqueue(chunk.slice(0, result.bytesRead));
      } catch (error) {
        await close().catch(() => undefined);
        controller.error(error);
      }
    },
    cancel: close,
  });
}

function notFound(): WebResponse {
  return respond({ status: 404, headers: NOSNIFF });
}

function isOrdinaryMiss(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

function report(options: StaticOptions, error: unknown): void {
  try {
    options.onError(error);
  } catch {
    // A diagnostic sink cannot turn a uniform 404 into a rejected request.
  }
}

async function closeQuietly(handle: FileHandle): Promise<void> {
  await handle.close().catch(() => undefined);
}
