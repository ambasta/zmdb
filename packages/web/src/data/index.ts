// @zmdb/web — zmdb data-layer integration (epic #277, spec ./SPEC.md).
// Typed DI token for a repository + an adapter turning a validator into the
// pipeline's validateBody hook. No consumer `as`, no runtime parser.

import type { BaseRepository } from '@zmdb/repository';
import type { CoreSchema } from '@zmdb/schema-core';

import { createToken, type Token } from '../di/index.ts';

/**
 * A typed DI token for a repository over schema `S`. Register a
 * `defineRepository(S, ...)` instance under it and `@Inject` it into a
 * controller — the injected field is typed `BaseRepository<S>`, no `as`.
 */
export function repositoryToken<S extends CoreSchema<string>>(name: string): Token<BaseRepository<S>> {
  return createToken<BaseRepository<S>>(name);
}

/**
 * Adapt a validator into a pipeline `validateBody` hook. Pass any function that
 * returns the validated value or throws — e.g. `@zmdb/aot-validator`'s
 * `assert<CreateDTO<S>>`. The framework embeds no parser of its own.
 */
export function validateWith<T>(validator: (raw: unknown) => T): (raw: unknown) => T {
  return validator;
}
