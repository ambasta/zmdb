// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/app — curated facade over the protocol-neutral application kernel.
export {
  Container,
  Inject,
  Module,
  UnresolvedTokenError,
  compileModule,
  createApplication,
  createStateUpdatePayload,
  defineStateTransitions,
  defineEntityStateMachine,
  createToken,
  injectionsOf,
  lazy,
  metadataOf,
  moduleDefOf,
} from '@zmdb/app';
export type {
  Application,
  StateTransitions,
  AllowedTargetStates,
  StateUpdateDTO,
  EntityStateMachineOptions,
  EntityStateMachine,
  ApplicationExtension,
  ApplicationExtensionContext,
  ApplicationMetadata,
  ApplicationOptions,
  CompiledModule,
  Constructor,
  LazyImport,
  LazyModuleHandle,
  LazyStatus,
  ModuleClass,
  ModuleDef,
  OnApplicationBootstrap,
  OnModuleInit,
  OnShutdown,
  ProviderDef,
  Scope,
  Token,
} from '@zmdb/app';
