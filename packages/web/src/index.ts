// @zmdb/web — Stage-3 decorator web framework for the zmdb ecosystem.
//
// This is the package baseline (epic #247, spec packages/web/SPEC.md): the one
// primitive every later decorator builds on. Routing, typed Ctx, DI, domain
// state machines, the request pipeline and the NestJS-parity layers arrive in
// their own sub-modules under later issues.
//
// Invariants: no reflect-metadata, no runtime reflection, Stage 3 decorators
// only (`experimentalDecorators: false`), and no `as`/`any`/`!` on the consumer
// surface. See ARCHITECTURE.md §2.

// Install the well-known Symbol.metadata if the runtime lacks it (Node 26 does).
// Must run before any decorated class is evaluated — hence the side-effecting
// import at the top of the package entry.
import './polyfill.ts';

// The Stage-3 metadata record type. `Symbol.metadata` is a well-known symbol
// present on Node 26; `DecoratorMetadata`/`DecoratorMetadataObject` come from
// the standard `lib`. We model a metadata record as an index of unknown values
// — consumers narrow their own slots, and the framework's typed accessors
// (added by later issues) expose strongly-typed views without assertions.
export type WebMetadata = DecoratorMetadataObject;

// A carrier that *may* have a Stage-3 metadata record attached. Decorated
// classes get one via the runtime; `null` when the class was never decorated.
interface HasMetadata {
  readonly [Symbol.metadata]?: DecoratorMetadata | null;
}

const EMPTY: WebMetadata = Object.freeze(Object.create(null));

// Type guard proving a value carries a non-null metadata record. This is the
// single trust boundary for reading the well-known symbol; it uses a runtime
// check (not an assertion) so no `as` is needed.
function hasMetadata(value: object): value is { readonly [Symbol.metadata]: DecoratorMetadata } {
  const carrier: HasMetadata = value;
  const record = carrier[Symbol.metadata];
  return record !== undefined && record !== null;
}

/**
 * Read the Stage-3 `Symbol.metadata` record off a decorated class (or any
 * object carrying one). Never returns `undefined`: an undecorated target yields
 * a shared, frozen empty record so callers can read slots unconditionally.
 *
 * No `reflect-metadata`, no `as` — the well-known symbol is read behind a type
 * guard.
 */
export function metadataOf(target: object): WebMetadata {
  return hasMetadata(target) ? target[Symbol.metadata] : EMPTY;
}

// Controllers & routing (Stage-3 decorators → context.metadata). See ./routing.
export {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  getRoutes,
  type HttpMethod,
  type RouteDefinition,
  type ResolvedRoute,
} from './routing/index.ts';

// Typed request context + compile-time path-param derivation. See ./context.
export { extractParams, type PathParams, type QueryValues, type Ctx, type HandlerFor } from './context/index.ts';

// Compile-time dependency injection: Container + @Inject. See ./di.
export { Container, createToken, Inject, UnresolvedTokenError, type Token, type Constructor } from './di/index.ts';

// Compile-time domain state machines (branded/phantom types). See ./state.
export { defineState, transition, type Brand, type State } from './state/index.ts';
