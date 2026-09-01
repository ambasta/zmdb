// @zmdb/web — DTO validation & serialization pipes (epic #297, spec ./SPEC.md).
// Bind routes to schema-derived DTO validation (a Pipe) and entity serialization
// (an Interceptor), built on the middleware chain. Zero runtime parser (consumer
// supplies the AOT assert); no `as` on the consumer surface.

import { compileFastStringifier } from '@zmdb/aot-validator/serialization';

import type { Chain, Pipe, Interceptor } from '../middleware/index.js';
import { parseMultipart, type Multipart, type UploadLimits } from '../upload/index.js';

/**
 * A validation pipe: runs `validator` (e.g. `assert<CreateDTO<S>>`) on the body,
 * yielding the typed value. A throw becomes the chain's 400. The framework
 * embeds no parser — validation is the consumer's AOT `assert`.
 */
export function validationPipe<T>(validator: (raw: unknown) => T): Pipe<unknown, T> {
  return {
    transform(value: unknown): T {
      return validator(value);
    },
  };
}

/**
 * A pipe that only converts: the wire→app decode at the boundary (plan D3).
 *
 * Separate from `validationPipe` because the two do different jobs and the order matters.
 * `wireDecoder(Schema)` turns the ISO string JSON carries into the `Date` a `CreateDTO`
 * asks for; the validator then checks the app type. Decoding after validation would mean
 * validating the wrong layer, and doing both in one function is how a validator ends up
 * accepting `Date | string` and checking neither.
 */
export function decodePipe<In = unknown, Out = unknown>(decode: (value: In) => Out): Pipe<In, Out> {
  return {
    transform(value: In): Out {
      return decode(value);
    },
  };
}

/**
 * Parse the exact request bytes as multipart at the ordinary pipe boundary.
 *
 * The returned `Multipart` remains available to later validation pipes, so form
 * fields use the same validation path as JSON bodies.
 */
export function multipartPipe(limits: Partial<UploadLimits> = {}): Pipe<unknown, Multipart> {
  const configured = { ...limits };
  return {
    transform(value, ctx): Multipart {
      return parseMultipart(value, ctx.headers['content-type'] ?? '', configured);
    },
  };
}

/**
 * A serialization interceptor: transforms the handler's result via `serialize`
 * function or a compiled schema stringifier (default: identity — the pipeline
 * JSON-encodes downstream). Pass an entity serializer or schema to shape the response.
 */
export function serializationInterceptor(
  serializeOrSchema: ((result: unknown) => unknown) | unknown = (r: unknown) => r,
): Interceptor {
  let serializeFn: (result: unknown) => unknown;
  if (typeof serializeOrSchema === 'function') {
    serializeFn = serializeOrSchema as (result: unknown) => unknown;
  } else if (serializeOrSchema !== null && typeof serializeOrSchema === 'object') {
    serializeFn = compileFastStringifier(serializeOrSchema);
  } else {
    serializeFn = (r: unknown) => r;
  }

  return {
    async intercept(_ctx, next): Promise<unknown> {
      const result = await next();
      return serializeFn(result);
    },
  };
}

/** Options for `dtoChain`. */
export interface DtoChainOptions<T> {
  /** The wire→app decode, e.g. `wireDecoder(Schema, 'create')`. Runs before `validate`. */
  readonly decode?: (raw: unknown) => unknown;
  readonly validate: (raw: unknown) => T;
  readonly serialize?: ((result: unknown) => unknown) | unknown;
  readonly schema?: unknown;
}

/**
 * Compose a Chain with the validation pipe (+ optional decode pipe and
 * serialization interceptor), so a route adopts DTO validation/serialization in
 * one call.
 */
export function dtoChain<T>(options: DtoChainOptions<T>): Chain {
  const targetSerialize =
    options.schema !== undefined && options.serialize === undefined ? options.schema : options.serialize;
  return {
    guards: [],
    // Decode first, then validate: the validator checks the app type, which is only what
    // the body holds once the two types JSON cannot carry have been converted.
    pipes:
      options.decode === undefined
        ? [validationPipe(options.validate)]
        : [decodePipe(options.decode), validationPipe(options.validate)],
    interceptors: targetSerialize === undefined ? [] : [serializationInterceptor(targetSerialize)],
    filters: [],
  };
}
