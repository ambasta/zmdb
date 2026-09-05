import { Injector, createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import type { EnvironmentInjector } from '@angular/core';
import { createZmdbAngular } from '@zmdb/angular';

import type {
  AdapterConformanceBinding,
  ConformanceMutation,
  ConformanceQuery,
  MutationRunner,
  QueryLoader,
  QuerySnapshot,
} from './conformance.js';
import type { AdapterPackageExpectation } from './package-matrix.js';

function missing(primitive: string): Error {
  return new Error(`@zmdb/angular ${primitive} conformance driver is not mounted`);
}

function parentInjector(name: string): EnvironmentInjector {
  return createEnvironmentInjector([], Injector.NULL as EnvironmentInjector, `${name}-parent`);
}

export function createAngularConformanceBinding<Client>(
  packageExpectation: AdapterPackageExpectation,
): AdapterConformanceBinding<Client> {
  const bindings = createZmdbAngular<Client>('adapter conformance client');

  return {
    package: packageExpectation,
    prepareQuery<Input, Output>(options: {
      readonly client: Client;
      readonly input: Input;
      readonly load: QueryLoader<Client, Input, Output>;
    }): ConformanceQuery<Input, Output> {
      let query:
        | {
            readonly data: () => Output | undefined;
            readonly error: () => unknown;
            readonly loading: () => boolean;
            setInput(input: Input): void;
            refresh(): Promise<void>;
          }
        | undefined;
      let latestSettlement = Promise.resolve();
      let parent: EnvironmentInjector | undefined;
      let owner: EnvironmentInjector | undefined;
      let mounted = false;
      let disposed = false;

      const current = () => {
        if (query === undefined) throw missing('query');
        return query;
      };

      const load = (client: Client, input: Input, signal: AbortSignal): Promise<Output> => {
        const operation = Promise.resolve(options.load(client, input, signal));
        latestSettlement = operation.then(
          () => undefined,
          () => undefined,
        );
        return operation;
      };

      return {
        snapshot(): QuerySnapshot<Output> {
          if (query === undefined) return { data: undefined, error: undefined, loading: false };
          return {
            data: query.data(),
            error: query.error(),
            loading: query.loading(),
          };
        },
        async mount(): Promise<void> {
          if (mounted) throw new Error('@zmdb/angular query conformance driver mounted twice');
          if (disposed) throw new Error('@zmdb/angular query conformance driver mounted after disposal');
          parent = parentInjector('adapter-query');
          owner = createEnvironmentInjector(
            [bindings.provideZmdbClient(options.client)],
            parent,
            'adapter-query-owner',
          );
          query = runInInjectionContext(owner, () => bindings.zmdbQuery(options.input, load));
          mounted = true;
        },
        async update(input: Input): Promise<void> {
          current().setInput(input);
        },
        refresh(): Promise<void> {
          return current().refresh();
        },
        whenSettled(): Promise<void> {
          if (!mounted) return Promise.reject(missing('query'));
          return latestSettlement;
        },
        async dispose(): Promise<void> {
          if (disposed) return;
          disposed = true;
          owner?.destroy();
          parent?.destroy();
        },
      };
    },
    prepareMutation<Input, Output>(options: {
      readonly client: Client;
      readonly run: MutationRunner<Client, Input, Output>;
    }): ConformanceMutation<Input, Output> {
      let mutation:
        | {
            readonly error: () => unknown;
            readonly pending: () => boolean;
            mutate(input: Input): Promise<Output>;
          }
        | undefined;
      let parent: EnvironmentInjector | undefined;
      let owner: EnvironmentInjector | undefined;
      let mounted = false;
      let disposed = false;

      const current = () => {
        if (mutation === undefined) throw missing('mutation');
        return mutation;
      };

      return {
        snapshot() {
          if (mutation === undefined) return { error: undefined, pending: false };
          return { error: mutation.error(), pending: mutation.pending() };
        },
        async mount(): Promise<void> {
          if (mounted) throw new Error('@zmdb/angular mutation conformance driver mounted twice');
          if (disposed) throw new Error('@zmdb/angular mutation conformance driver mounted after disposal');
          parent = parentInjector('adapter-mutation');
          owner = createEnvironmentInjector(
            [bindings.provideZmdbClient(options.client)],
            parent,
            'adapter-mutation-owner',
          );
          mutation = runInInjectionContext(owner, () => bindings.zmdbMutation(options.run));
          mounted = true;
        },
        mutate(input: Input): Promise<Output> {
          return current().mutate(input);
        },
        async dispose(): Promise<void> {
          if (disposed) return;
          disposed = true;
          owner?.destroy();
          parent?.destroy();
        },
      };
    },
    runSsrQuery<Input, Output>(options: {
      readonly client: Client;
      readonly input: Input;
      readonly load: QueryLoader<Client, Input, Output>;
    }): Promise<Output> {
      const parent = parentInjector('adapter-ssr');
      const owner = createEnvironmentInjector(
        [bindings.provideZmdbClient(options.client)],
        parent,
        'adapter-ssr-request',
      );
      const operation = new Promise<Output>((resolve, reject) => {
        runInInjectionContext(owner, () => {
          bindings.zmdbQuery(options.input, (client, input, signal) => {
            const result = Promise.resolve(options.load(client, input, signal));
            void result.then(resolve, reject);
            return result;
          });
        });
      });
      return operation.finally(() => {
        owner.destroy();
        parent.destroy();
      });
    },
  };
}
