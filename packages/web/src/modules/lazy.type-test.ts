import type { Equal, Expect } from '@zmdb/schema-core';

import type {
  CompiledModule,
  LazyImport,
  LazyModuleHandle,
  LazyStatus,
  ModuleClass,
  ModuleDef,
  lazy,
} from './index.js';

type FrozenLazyImport = { readonly kind: 'lazy'; readonly module: ModuleClass };
type FrozenLazyStatus = 'unloaded' | 'loading' | 'loaded' | 'failed';
type FrozenHandle = {
  readonly name: string;
  readonly status: FrozenLazyStatus;
  load(): Promise<void>;
};
type FrozenImports = readonly (ModuleClass | FrozenLazyImport)[] | undefined;

export type _LazyImportShape = Expect<Equal<LazyImport, FrozenLazyImport>>;
export type _LazyStatusUnion = Expect<Equal<LazyStatus, FrozenLazyStatus>>;
export type _HandleShape = Expect<Equal<LazyModuleHandle, FrozenHandle>>;
export type _LoadReturns = Expect<Equal<ReturnType<LazyModuleHandle['load']>, Promise<void>>>;
export type _LazySignature = Expect<Equal<typeof lazy, (module: ModuleClass) => FrozenLazyImport>>;
export type _ImportsWiden = Expect<Equal<ModuleDef['imports'], FrozenImports>>;
export type _LazyRequired = Expect<Equal<CompiledModule['lazy'], readonly FrozenHandle[]>>;
export type _CompiledKeys = Expect<Equal<keyof CompiledModule, 'container' | 'controllers' | 'commands' | 'lazy'>>;
export type _ControllersUnchanged = Expect<Equal<CompiledModule['controllers'], readonly object[]>>;
export type _CommandsAdded = Expect<Equal<CompiledModule['commands'], readonly object[]>>;

type ImportEntry = NonNullable<ModuleDef['imports']>[number];

/** Pass one follows classes immediately and leaves lazy declarations for pass two. */
export function classifyImport(entry: ImportEntry): string {
  if (typeof entry === 'function') {
    const eager: ModuleClass = entry;
    return `eager:${eager.name}`;
  }
  const deferred: LazyImport = entry;
  return `lazy:${deferred.module.name}`;
}

export type _EntryUnion = Expect<Equal<ImportEntry, ModuleClass | FrozenLazyImport>>;
