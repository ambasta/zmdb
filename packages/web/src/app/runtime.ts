import type { CompiledModule } from '../modules/index.js';

const compilations = new WeakMap<object, CompiledModule>();

export function rememberAppCompilation(app: object, compiled: CompiledModule): void {
  compilations.set(app, compiled);
}

export function appCompilationOf(app: object): CompiledModule | undefined {
  return compilations.get(app);
}
