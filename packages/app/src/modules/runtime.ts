import type { Constructor } from '../di/index.js';
import type { CompiledModule } from './index.js';

export type CompiledController =
  | { readonly kind: 'eager'; readonly controller: object }
  | {
      readonly kind: 'deferred';
      readonly controller: Constructor<object>;
      readonly instance: () => Promise<object>;
    };

export interface CompiledModuleRuntime {
  readonly controllers: readonly CompiledController[];
  beginShutdown(): void;
  waitForLoads(): Promise<void>;
}

const runtimes = new WeakMap<CompiledModule, CompiledModuleRuntime>();

export function rememberRuntime(compiled: CompiledModule, runtime: CompiledModuleRuntime): void {
  runtimes.set(compiled, runtime);
}

export function runtimeOf(compiled: CompiledModule): CompiledModuleRuntime | undefined {
  return runtimes.get(compiled);
}
