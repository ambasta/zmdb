// @zmdb/web — bounded multipart/form-data parsing (epic #564, spec ./SPEC.md).
//
// The adapters have already bounded and materialised the request body. This
// parser scans that byte array without decoding file contents, bounds every
// header and part before allocating its representation, and never performs I/O.

import { BoundaryStatusError } from '../middleware/errors.js';

export interface UploadLimits {
  readonly maxParts: number;
  readonly maxPartBytes: number;
  readonly maxTotalBytes: number;
  readonly maxFieldNameBytes: number;
  readonly maxFilenameBytes: number;
  readonly maxPartHeaderBytes: number;
}

export const UPLOAD_DEFAULTS: UploadLimits = Object.freeze({
  maxParts: 16,
  maxPartBytes: 1_048_576,
  maxTotalBytes: 8_388_608,
  maxFieldNameBytes: 100,
  maxFilenameBytes: 255,
  maxPartHeaderBytes: 1024,
});

export interface UploadPart {
  readonly name: string;
  readonly filename: string | undefined;
  readonly declaredType: string | undefined;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface Multipart {
  readonly fields: Readonly<Record<string, string>>;
  readonly files: readonly UploadPart[];
}

interface ParsedPartHeaders {
  readonly name: string;
  readonly filename: string | undefined;
  readonly declaredType: string | undefined;
}

interface ParameterizedValue {
  readonly value: string;
  readonly parameters: ReadonlyMap<string, string>;
}

const CR = 13;
const LF = 10;
const DASH = 45;
const SEMICOLON = 59;
const EQUALS = 61;
const DOUBLE_QUOTE = 34;
const BACKSLASH = 92;
const SPACE = 32;
const TAB = 9;

const utf8 = new TextEncoder();
const text = new TextDecoder();
const strictText = new TextDecoder('utf-8', { fatal: true });

function malformed(message: string): never {
  throw new BoundaryStatusError(400, message);
}

function tooLarge(limit: keyof UploadLimits): never {
  throw new BoundaryStatusError(413, `multipart body exceeds ${limit}`);
}

function resolvedLimits(overrides: Partial<UploadLimits>): UploadLimits {
  const limits: UploadLimits = { ...UPLOAD_DEFAULTS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
  return limits;
}

function bodyBytes(rawBody: unknown, maxTotalBytes: number): Uint8Array<ArrayBuffer> {
  if (!(rawBody instanceof Uint8Array)) {
    malformed('multipart body must be a Uint8Array');
  }
  if (rawBody.byteLength > maxTotalBytes) {
    tooLarge('maxTotalBytes');
  }
  if (rawBody.buffer instanceof ArrayBuffer) {
    return new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  }
  return new Uint8Array(rawBody);
}

function trimStart(value: string, start: number, end: number): number {
  let at = start;
  while (at < end) {
    const code = value.charCodeAt(at);
    if (code !== SPACE && code !== TAB) {
      break;
    }
    at += 1;
  }
  return at;
}

function trimEnd(value: string, start: number, end: number): number {
  let at = end;
  while (at > start) {
    const code = value.charCodeAt(at - 1);
    if (code !== SPACE && code !== TAB) {
      break;
    }
    at -= 1;
  }
  return at;
}

function isParameterNameCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 33 ||
    code === 35 ||
    code === 36 ||
    code === 37 ||
    code === 38 ||
    code === 39 ||
    code === 42 ||
    code === 43 ||
    code === 45 ||
    code === 46 ||
    code === 94 ||
    code === 95 ||
    code === 96 ||
    code === 124 ||
    code === 126
  );
}

function parseParameterizedValue(source: string): ParameterizedValue {
  const firstSemicolon = source.indexOf(';');
  const valueEnd = firstSemicolon === -1 ? source.length : firstSemicolon;
  const valueStart = trimStart(source, 0, valueEnd);
  const trimmedValueEnd = trimEnd(source, valueStart, valueEnd);
  if (valueStart === trimmedValueEnd) {
    malformed('multipart header value is empty');
  }

  const parameters = new Map<string, string>();
  let at = firstSemicolon === -1 ? source.length : firstSemicolon + 1;
  while (at < source.length) {
    at = trimStart(source, at, source.length);
    if (at === source.length) {
      break;
    }

    const nameStart = at;
    while (at < source.length && isParameterNameCode(source.charCodeAt(at))) {
      at += 1;
    }
    if (at === nameStart) {
      malformed('multipart parameter has no name');
    }
    const name = source.slice(nameStart, at).toLowerCase();
    at = trimStart(source, at, source.length);
    if (source.charCodeAt(at) !== EQUALS) {
      malformed(`multipart parameter "${name}" has no value`);
    }
    at = trimStart(source, at + 1, source.length);

    let parameter = '';
    if (source.charCodeAt(at) === DOUBLE_QUOTE) {
      at += 1;
      let closed = false;
      while (at < source.length) {
        const code = source.charCodeAt(at);
        if (code === DOUBLE_QUOTE) {
          at += 1;
          closed = true;
          break;
        }
        if (code === BACKSLASH) {
          at += 1;
          if (at === source.length) {
            malformed(`multipart parameter "${name}" has an incomplete escape`);
          }
          parameter += '\\';
          parameter += source[at];
          at += 1;
          continue;
        }
        if (code < SPACE || code === 127) {
          malformed(`multipart parameter "${name}" contains a control character`);
        }
        parameter += source[at];
        at += 1;
      }
      if (!closed) {
        malformed(`multipart parameter "${name}" has no closing quote`);
      }
      at = trimStart(source, at, source.length);
      if (at < source.length && source.charCodeAt(at) !== SEMICOLON) {
        malformed(`multipart parameter "${name}" has trailing data`);
      }
    } else {
      const parameterStart = at;
      while (at < source.length && source.charCodeAt(at) !== SEMICOLON) {
        at += 1;
      }
      const parameterEnd = trimEnd(source, parameterStart, at);
      if (parameterStart === parameterEnd) {
        malformed(`multipart parameter "${name}" is empty`);
      }
      parameter = source.slice(parameterStart, parameterEnd);
    }

    if (parameters.has(name)) {
      malformed(`multipart parameter "${name}" is repeated`);
    }
    parameters.set(name, parameter);
    if (at < source.length) {
      at += 1;
    }
  }

  return { value: source.slice(valueStart, trimmedValueEnd), parameters };
}

function isBoundaryCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 39 ||
    code === 40 ||
    code === 41 ||
    code === 43 ||
    code === 44 ||
    code === 45 ||
    code === 46 ||
    code === 47 ||
    code === 58 ||
    code === 61 ||
    code === 63 ||
    code === 95 ||
    code === SPACE
  );
}

function boundaryBytes(contentType: string): Uint8Array<ArrayBuffer> {
  const parsed = parseParameterizedValue(contentType);
  if (parsed.value.toLowerCase() !== 'multipart/form-data') {
    malformed('content-type must be multipart/form-data');
  }
  const boundary = parsed.parameters.get('boundary');
  if (boundary === undefined || boundary.length === 0 || boundary.length > 70) {
    malformed('multipart/form-data requires a boundary between 1 and 70 bytes');
  }
  for (let index = 0; index < boundary.length; index += 1) {
    if (!isBoundaryCode(boundary.charCodeAt(index))) {
      malformed('multipart boundary contains an invalid character');
    }
  }
  if (boundary.charCodeAt(boundary.length - 1) === SPACE) {
    malformed('multipart boundary cannot end with whitespace');
  }
  return utf8.encode(boundary);
}

function matchesAt(body: Uint8Array<ArrayBuffer>, at: number, wanted: Uint8Array<ArrayBuffer>): boolean {
  if (at + wanted.length > body.length) {
    return false;
  }
  for (let index = 0; index < wanted.length; index += 1) {
    if (body[at + index] !== wanted[index]) {
      return false;
    }
  }
  return true;
}

function openingBoundary(boundary: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const marker = new Uint8Array(boundary.length + 2);
  marker[0] = DASH;
  marker[1] = DASH;
  marker.set(boundary, 2);
  return marker;
}

function headerEnd(body: Uint8Array<ArrayBuffer>, start: number, maxBytes: number): number {
  for (let at = start; at + 3 < body.length; at += 1) {
    if (at - start > maxBytes) {
      tooLarge('maxPartHeaderBytes');
    }
    if (body[at] === CR && body[at + 1] === LF && body[at + 2] === CR && body[at + 3] === LF) {
      return at;
    }
  }
  if (body.length - start > maxBytes) {
    tooLarge('maxPartHeaderBytes');
  }
  malformed('multipart part has no complete header block');
}

function nextBoundary(
  body: Uint8Array<ArrayBuffer>,
  start: number,
  marker: Uint8Array<ArrayBuffer>,
  maxPartBytes: number,
): number {
  for (let at = start; at + marker.length + 2 <= body.length; at += 1) {
    if (at - start > maxPartBytes) {
      tooLarge('maxPartBytes');
    }
    if (
      body[at] === CR &&
      body[at + 1] === LF &&
      matchesAt(body, at + 2, marker) &&
      ((body[at + 2 + marker.length] === DASH && body[at + 3 + marker.length] === DASH) ||
        (body[at + 2 + marker.length] === CR && body[at + 3 + marker.length] === LF))
    ) {
      return at;
    }
  }
  if (body.length - start > maxPartBytes) {
    tooLarge('maxPartBytes');
  }
  malformed('multipart body has no closing boundary');
}

function decodeHeaderBlock(value: Uint8Array<ArrayBuffer>): string {
  try {
    return strictText.decode(value);
  } catch {
    malformed('multipart part headers are not valid UTF-8');
  }
}

function parsePartHeaders(value: Uint8Array<ArrayBuffer>): ParsedPartHeaders {
  const block = decodeHeaderBlock(value);
  const lines = block.split('\r\n');
  let disposition: string | undefined;
  let declaredType: string | undefined;
  let offset = 0;

  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      malformed('multipart part contains a malformed header');
    }
    const name = line.slice(0, separator);
    for (let index = 0; index < name.length; index += 1) {
      if (!isParameterNameCode(name.charCodeAt(index))) {
        malformed('multipart part contains an invalid header name');
      }
    }
    const lower = name.toLowerCase();
    const valueStart = trimStart(line, separator + 1, line.length);
    const headerValue = line.slice(valueStart);
    if (lower === 'content-disposition') {
      if (disposition !== undefined) {
        malformed('multipart part repeats content-disposition');
      }
      disposition = headerValue;
    } else if (lower === 'content-type' && declaredType === undefined) {
      const blockValueStart = offset + valueStart;
      declaredType = block.slice(blockValueStart);
    }
    offset += line.length + 2;
  }

  if (disposition === undefined) {
    malformed('multipart part has no content-disposition');
  }
  const parsed = parseParameterizedValue(disposition);
  if (parsed.value.toLowerCase() !== 'form-data') {
    malformed('multipart content-disposition must be form-data');
  }
  const name = parsed.parameters.get('name');
  if (name === undefined || name.length === 0) {
    malformed('multipart content-disposition requires a field name');
  }

  return {
    name,
    filename: parsed.parameters.get('filename'),
    declaredType,
  };
}

function unsafeFilename(filename: string): boolean {
  return (
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\u0000') ||
    filename === '.' ||
    filename === '..' ||
    /^[A-Za-z]:/.test(filename)
  );
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = utf8.encode(value);
  if (encoded.length <= maxBytes) {
    return value;
  }
  let end = maxBytes;
  while (end > 0) {
    try {
      return strictText.decode(encoded.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  return '';
}

function finishBoundary(body: Uint8Array<ArrayBuffer>, at: number): void {
  if (at === body.length) {
    return;
  }
  if (at + 2 === body.length && body[at] === CR && body[at + 1] === LF) {
    return;
  }
  malformed('multipart closing boundary has trailing data');
}

/**
 * Parse one bounded `multipart/form-data` body without decoding file contents.
 *
 * The adapter's `maxBodyBytes` is the transfer-time limit. This function checks
 * `maxTotalBytes` before scanning and then stops each bounded scan at the first
 * exceeded part/header limit, before decoding or returning that region.
 */
export function parseMultipart(
  rawBody: unknown,
  contentType: string,
  overrides: Partial<UploadLimits> = {},
): Multipart {
  const limits = resolvedLimits(overrides);
  const body = bodyBytes(rawBody, limits.maxTotalBytes);

  const boundary = boundaryBytes(contentType);
  const marker = openingBoundary(boundary);
  if (!matchesAt(body, 0, marker)) {
    malformed('multipart body does not start with its declared boundary');
  }

  const fields = new Map<string, string>();
  const files: UploadPart[] = [];
  let cursor = marker.length;
  if (body[cursor] === DASH && body[cursor + 1] === DASH) {
    finishBoundary(body, cursor + 2);
    return {
      fields: Object.freeze(Object.fromEntries(fields)),
      files: Object.freeze(files),
    };
  }
  if (body[cursor] !== CR || body[cursor + 1] !== LF) {
    malformed('multipart opening boundary is malformed');
  }
  cursor += 2;

  let parts = 0;
  for (;;) {
    parts += 1;
    if (parts > limits.maxParts) {
      tooLarge('maxParts');
    }

    const headersEnd = headerEnd(body, cursor, limits.maxPartHeaderBytes);
    const headers = parsePartHeaders(body.subarray(cursor, headersEnd));
    if (utf8.encode(headers.name).byteLength > limits.maxFieldNameBytes) {
      tooLarge('maxFieldNameBytes');
    }

    const partStart = headersEnd + 4;
    const delimiter = nextBoundary(body, partStart, marker, limits.maxPartBytes);
    const bytes = body.subarray(partStart, delimiter);
    if (headers.filename === undefined) {
      fields.set(headers.name, text.decode(bytes));
    } else {
      if (unsafeFilename(headers.filename)) {
        malformed('multipart filename must be an opaque label, not a path');
      }
      files.push({
        name: headers.name,
        filename: truncateUtf8(headers.filename, limits.maxFilenameBytes),
        declaredType: headers.declaredType,
        bytes,
      });
    }

    cursor = delimiter + 2 + marker.length;
    if (body[cursor] === DASH && body[cursor + 1] === DASH) {
      finishBoundary(body, cursor + 2);
      break;
    }
    if (body[cursor] !== CR || body[cursor + 1] !== LF) {
      malformed('multipart boundary is malformed');
    }
    cursor += 2;
  }

  return {
    fields: Object.freeze(Object.fromEntries(fields)),
    files: Object.freeze(files),
  };
}
