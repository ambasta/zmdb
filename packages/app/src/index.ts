// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// @zmdb/app — the protocol-neutral application kernel.
//
// This entry owns the one Stage-3 metadata installation and reader, the
// application graph, dependency injection and lifecycle. Concern-heavy
// capabilities such as command parsing, events and observability remain behind
// their explicit subpaths.

import './polyfill.js';

export type ApplicationMetadata = DecoratorMetadataObject;

interface HasMetadata {
  readonly [Symbol.metadata]?: DecoratorMetadata | null;
}

const EMPTY: ApplicationMetadata = Object.freeze(Object.create(null));

function hasMetadata(value: object): value is { readonly [Symbol.metadata]: DecoratorMetadata } {
  const carrier: HasMetadata = value;
  const record = carrier[Symbol.metadata];
  return record !== undefined && record !== null;
}

/** Read one Stage-3 metadata record, or the shared frozen empty record. */
export function metadataOf(target: object): ApplicationMetadata {
  return hasMetadata(target) ? target[Symbol.metadata] : EMPTY;
}

export {
  Container,
  createToken,
  Inject,
  injectionsOf,
  UnresolvedTokenError,
  type Constructor,
  type Scope,
  type Token,
} from './di/index.js';
export {
  compileModule,
  lazy,
  Module,
  moduleDefOf,
  type CompiledModule,
  type LazyImport,
  type LazyModuleHandle,
  type LazyStatus,
  type ModuleClass,
  type ModuleDef,
  type ProviderDef,
} from './modules/index.js';
export {
  createApplication,
  type Application,
  type ApplicationExtension,
  type ApplicationExtensionContext,
  type ApplicationOptions,
} from './application.js';
export type { OnApplicationBootstrap, OnModuleInit, OnShutdown } from './lifecycle.js';

export { defineStateTransitions, createStateUpdatePayload, defineEntityStateMachine } from './state-transitions.js';
export type {
  StateTransitions,
  AllowedTargetStates,
  StateUpdateDTO,
  EntityStateMachineOptions,
  EntityStateMachine,
} from './state-transitions.js';
