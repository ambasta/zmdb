// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/app/modules — curated application-module facade.
export { Module, compileModule, lazy, moduleDefOf } from '@zmdb/app/modules';
export type {
  CompiledModule,
  LazyImport,
  LazyModuleHandle,
  LazyStatus,
  ModuleClass,
  ModuleDef,
  ProviderDef,
} from '@zmdb/app/modules';
