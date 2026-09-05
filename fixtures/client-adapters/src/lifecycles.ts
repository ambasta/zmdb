import { DestroyRef, Injector, createEnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import type { EnvironmentInjector } from '@angular/core';
import { createElement, useEffect } from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { createRoot, onCleanup } from 'solid-js';
import { readable } from 'svelte/store';
import { effectScope, onScopeDispose } from 'vue';

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

function valueAfterActivation<Value>(activated: boolean, value: Value | undefined, name: string): Value {
  if (!activated) throw new Error(`${name} lifecycle did not activate its setup callback`);
  return value as Value;
}

function reactHarness(): LifecycleHarness {
  return {
    name: 'react',
    async activate<Value>(setup: (registerCleanup: RegisterCleanup) => Value): Promise<ActivatedLifecycle<Value>> {
      let activated = false;
      let value: Value | undefined;
      let renderer: ReactTestRenderer | undefined;
      let disposed = false;
      const previousActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

      function Probe() {
        useEffect(() => {
          const cleanups: (() => void)[] = [];
          value = setup(cleanup => cleanups.push(cleanup));
          activated = true;
          return () => {
            for (const cleanup of cleanups.toReversed()) cleanup();
          };
        }, []);
        return null;
      }

      const originalError = console.error;
      console.error = (message?: unknown, ...rest: unknown[]): void => {
        if (message === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') {
          return;
        }
        originalError(message, ...rest);
      };
      try {
        await act(async () => {
          renderer = create(createElement(Probe));
        });
      } finally {
        console.error = originalError;
        if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
        else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment);
      }

      return {
        value: valueAfterActivation(activated, value, 'react'),
        async dispose() {
          if (disposed) return;
          disposed = true;
          const current = renderer;
          if (current === undefined) throw new Error('React lifecycle lost its renderer');
          const previous = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
          Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
          try {
            await act(async () => {
              current.unmount();
            });
          } finally {
            if (previous === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
            else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous);
          }
        },
      };
    },
  };
}

function angularHarness(): LifecycleHarness {
  return {
    name: 'angular',
    async activate<Value>(setup: (registerCleanup: RegisterCleanup) => Value): Promise<ActivatedLifecycle<Value>> {
      const parent = createEnvironmentInjector([], Injector.NULL as EnvironmentInjector, 'adapter-test-parent');
      const injector = createEnvironmentInjector([], parent, 'adapter-test-owner');
      let disposed = false;
      const value = runInInjectionContext(injector, () => {
        const destroy = inject(DestroyRef);
        return setup(cleanup => {
          destroy.onDestroy(cleanup);
        });
      });
      return {
        value,
        async dispose() {
          if (disposed) return;
          disposed = true;
          injector.destroy();
          parent.destroy();
        },
      };
    },
  };
}

function vueHarness(): LifecycleHarness {
  return {
    name: 'vue',
    async activate<Value>(setup: (registerCleanup: RegisterCleanup) => Value): Promise<ActivatedLifecycle<Value>> {
      const scope = effectScope();
      let activated = false;
      let value: Value | undefined;
      scope.run(() => {
        value = setup(cleanup => {
          onScopeDispose(cleanup);
        });
        activated = true;
      });
      let disposed = false;
      return {
        value: valueAfterActivation(activated, value, 'vue'),
        async dispose() {
          if (disposed) return;
          disposed = true;
          scope.stop();
        },
      };
    },
  };
}

function svelteHarness(): LifecycleHarness {
  return {
    name: 'svelte',
    async activate<Value>(setup: (registerCleanup: RegisterCleanup) => Value): Promise<ActivatedLifecycle<Value>> {
      let activated = false;
      let value: Value | undefined;
      const owner = readable(undefined, () => {
        const cleanups: (() => void)[] = [];
        value = setup(cleanup => cleanups.push(cleanup));
        activated = true;
        return () => {
          for (const cleanup of cleanups.toReversed()) cleanup();
        };
      });
      const unsubscribe = owner.subscribe(() => undefined);
      let disposed = false;
      return {
        value: valueAfterActivation(activated, value, 'svelte'),
        async dispose() {
          if (disposed) return;
          disposed = true;
          unsubscribe();
        },
      };
    },
  };
}

function solidHarness(): LifecycleHarness {
  return {
    name: 'solid',
    async activate<Value>(setup: (registerCleanup: RegisterCleanup) => Value): Promise<ActivatedLifecycle<Value>> {
      let activated = false;
      let value: Value | undefined;
      const disposeRoot = createRoot(dispose => {
        value = setup(cleanup => {
          onCleanup(cleanup);
        });
        activated = true;
        return dispose;
      });
      let disposed = false;
      return {
        value: valueAfterActivation(activated, value, 'solid'),
        async dispose() {
          if (disposed) return;
          disposed = true;
          disposeRoot();
        },
      };
    },
  };
}

export const FRAMEWORK_LIFECYCLES: Readonly<Record<AdapterLifecycle, LifecycleHarness>> = Object.freeze({
  angular: angularHarness(),
  react: reactHarness(),
  solid: solidHarness(),
  svelte: svelteHarness(),
  vue: vueHarness(),
});
