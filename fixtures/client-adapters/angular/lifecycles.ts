import type { AdapterLifecycle } from './package-matrix.js';

export type RegisterCleanup = (cleanup: () => void) => void;

export interface ActivatedLifecycle<Value> {
  readonly value: Value;
  dispose(): Promise<void>;
}

export interface LifecycleHarness {
  readonly name: AdapterLifecycle;
  activate<Value>(setup: (registerCleanup: RegisterCleanup) => Value): Promise<ActivatedLifecycle<Value>>;
}
