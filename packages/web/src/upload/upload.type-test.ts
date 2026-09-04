// Type-level contract for the bounded multipart parser shipped by #569.

import type { Equal, Expect } from '@zmdb/schema-core';

import type { multipartPipe } from '../dto-pipes/index.js';
import type { Pipe } from '../middleware/index.js';
import type { parseMultipart, Multipart, UploadLimits, UploadPart } from './index.js';

interface ExpectedLimits {
  readonly maxParts: number;
  readonly maxPartBytes: number;
  readonly maxTotalBytes: number;
  readonly maxFieldNameBytes: number;
  readonly maxFilenameBytes: number;
  readonly maxPartHeaderBytes: number;
}

interface ExpectedPart {
  readonly name: string;
  readonly filename: string | undefined;
  readonly declaredType: string | undefined;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

interface ExpectedMultipart {
  readonly fields: Readonly<Record<string, string>>;
  readonly files: readonly UploadPart[];
}

export type _LimitsAreTotal = Expect<Equal<UploadLimits, ExpectedLimits>>;
export type _PartIsByteExact = Expect<Equal<UploadPart, ExpectedPart>>;
export type _MultipartShape = Expect<Equal<Multipart, ExpectedMultipart>>;
export type _ParserResult = Expect<Equal<ReturnType<typeof parseMultipart>, Multipart>>;
export type _MultipartPipe = Expect<Equal<ReturnType<typeof multipartPipe>, Pipe<unknown, Multipart>>>;
