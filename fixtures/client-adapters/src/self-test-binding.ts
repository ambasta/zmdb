import type {
  AdapterConformanceBinding,
  AdapterConformanceSubject,
  ConformanceQuery,
  QueryLoader,
  QuerySnapshot,
} from './conformance.js';
import type { AdapterPackageExpectation } from './package-matrix.js';

export interface HarnessSelfTestDefects {
  readonly leakOnDispose?: boolean;
  readonly overwriteWithStaleResult?: boolean;
  readonly shareSsrClient?: boolean;
}

/**
 * A defect-injectable oracle used only to prove that the #690 harness fails for
 * the bugs it claims to detect. Adapter packages must bind their native
 * lifecycle directly and must never import this file.
 */
export function createHarnessSelfTestBinding<Client>(
  packageExpectation: AdapterPackageExpectation,
  defects: HarnessSelfTestDefects = {},
): AdapterConformanceBinding<Client> {
  let sharedSsrClient: Client | undefined;

  return {
    package: packageExpectation,
    prepareQuery<Input, Output>(options: {
      readonly client: Client;
      readonly input: Input;
      readonly load: QueryLoader<Client, Input, Output>;
    }): ConformanceQuery<Input, Output> {
      let input = options.input;
      let snapshot: QuerySnapshot<Output> = { data: undefined, error: undefined, loading: false };
      let generation = 0;
      let latestSettlement = Promise.resolve();
      let mounted = false;
      let disposed = false;
      const controllers = new Set<AbortController>();

      const start = (): Promise<Output> => {
        generation += 1;
        const selectedGeneration = generation;
        const controller = new AbortController();
        controllers.add(controller);
        snapshot = { data: snapshot.data, error: undefined, loading: true };

        const operation = Promise.resolve(options.load(options.client, input, controller.signal)).then(
          value => {
            if (!disposed && (defects.overwriteWithStaleResult === true || selectedGeneration === generation)) {
              snapshot = { data: value, error: undefined, loading: false };
            }
            return value;
          },
          error => {
            if (
              !disposed &&
              !controller.signal.aborted &&
              (defects.overwriteWithStaleResult === true || selectedGeneration === generation)
            ) {
              snapshot = { data: snapshot.data, error, loading: false };
            }
            throw error;
          },
        );
        latestSettlement = operation.then(
          () => undefined,
          () => undefined,
        );
        void operation.then(
          () => {
            controllers.delete(controller);
          },
          () => {
            controllers.delete(controller);
          },
        );
        return operation;
      };

      const startWithoutUnhandledRejection = (): void => {
        void start().catch(() => undefined);
      };

      return {
        snapshot() {
          return snapshot;
        },
        async mount() {
          if (mounted) throw new Error('self-test query mounted twice');
          mounted = true;
          startWithoutUnhandledRejection();
        },
        async update(nextInput) {
          input = nextInput;
          snapshot = { data: undefined, error: undefined, loading: false };
          if (defects.overwriteWithStaleResult !== true) {
            for (const controller of controllers) {
              controller.abort(new Error('self-test input changed'));
            }
          }
          startWithoutUnhandledRejection();
        },
        refresh() {
          return start().then(() => undefined);
        },
        whenSettled() {
          return latestSettlement;
        },
        async dispose() {
          if (disposed) return;
          disposed = true;
          if (defects.leakOnDispose === true) return;
          for (const controller of controllers) {
            controller.abort(new Error('self-test owner disposed'));
          }
          await latestSettlement;
        },
      };
    },
    prepareMutation() {
      throw new Error('the harness self-test binding does not exercise mutations');
    },
    runSsrQuery(options) {
      const selectedClient = defects.shareSsrClient === true ? (sharedSsrClient ??= options.client) : options.client;
      return Promise.resolve(options.load(selectedClient, options.input, new AbortController().signal));
    },
  };
}

export function createLifecycleSelfTestSubject<Client>(
  binding: AdapterConformanceBinding<Client>,
): AdapterConformanceSubject<Client> {
  return {
    package: binding.package,
    prepareQuery(options) {
      const query = binding.prepareQuery(options);
      let mounting = Promise.resolve();
      return {
        get snapshot() {
          return query.snapshot();
        },
        activate(registerCleanup) {
          mounting = query.mount();
          void mounting.catch(() => undefined);
          registerCleanup(() => {
            void query.dispose();
          });
        },
        changeInput(input) {
          void mounting.then(() => query.update(input));
        },
        refresh() {
          return mounting.then(() => query.refresh());
        },
        whenSettled() {
          return mounting.then(() => query.whenSettled());
        },
      };
    },
    prepareMutation(options) {
      const mutation = binding.prepareMutation(options);
      let mounting = Promise.resolve();
      return {
        get snapshot() {
          return mutation.snapshot();
        },
        activate(registerCleanup) {
          mounting = mutation.mount();
          void mounting.catch(() => undefined);
          registerCleanup(() => {
            void mutation.dispose();
          });
        },
        mutate(input) {
          return mounting.then(() => mutation.mutate(input));
        },
      };
    },
    runSsrQuery(options) {
      return binding.runSsrQuery(options);
    },
  };
}
