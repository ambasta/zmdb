// @zmdb/web — DTO validation & serialization pipes (epic #297, spec ./SPEC.md).
// Bind routes to schema-derived DTO validation (a Pipe) and entity serialization
// (an Interceptor), built on the middleware chain. Zero runtime parser (consumer
// supplies the AOT assert); no `as` on the consumer surface.

import type { Chain, Pipe, Interceptor } from '../middleware/index.ts';

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
 * A serialization interceptor: transforms the handler's result via `serialize`
 * (default: identity — the pipeline JSON-encodes downstream). Pass an entity
 * serializer to shape the response from `Entity<S>`.
 */
export function serializationInterceptor(serialize: (result: unknown) => unknown = r => r): Interceptor {
  return {
    async intercept(_ctx, next): Promise<unknown> {
      const result = await next();
      return serialize(result);
    },
  };
}

/** Options for `dtoChain`. */
export interface DtoChainOptions<T> {
  readonly validate: (raw: unknown) => T;
  readonly serialize?: (result: unknown) => unknown;
}

/**
 * Compose a Chain with the validation pipe (+ optional serialization
 * interceptor), so a route adopts DTO validation/serialization in one call.
 */
export function dtoChain<T>(options: DtoChainOptions<T>): Chain {
  return {
    guards: [],
    pipes: [validationPipe(options.validate)],
    interceptors: options.serialize === undefined ? [] : [serializationInterceptor(options.serialize)],
    filters: [],
  };
}
