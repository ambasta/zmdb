import type { ActivatedLifecycle, LifecycleHarness, RegisterCleanup } from './lifecycles.js';
import type { AdapterPackageExpectation } from './package-matrix.js';

export type QueryLoader<Client, Input, Output> = (
  client: Client,
  input: Input,
  signal: AbortSignal,
) => PromiseLike<Output>;

export type MutationRunner<Client, Input, Output> = (
  client: Client,
  input: Input,
  signal: AbortSignal,
) => PromiseLike<Output>;

export interface QuerySnapshot<Output> {
  readonly data: Output | undefined;
  readonly error: unknown;
  readonly loading: boolean;
}

export interface MutationSnapshot {
  readonly error: unknown;
  readonly pending: boolean;
}

/**
 * The tests-freeze shape used until an adapter package supplies a native
 * binding. It is private fixture code, never a production adapter API.
 */
export interface PreparedQuery<Input, Output> {
  readonly snapshot: QuerySnapshot<Output>;
  activate(registerCleanup: RegisterCleanup): void;
  changeInput(input: Input): void;
  refresh(): Promise<void>;
  whenSettled(): Promise<void>;
}

export interface PreparedMutation<Input, Output> {
  readonly snapshot: MutationSnapshot;
  activate(registerCleanup: RegisterCleanup): void;
  mutate(input: Input): Promise<Output>;
}

export interface AdapterConformanceSubject<Client> {
  readonly package: AdapterPackageExpectation;
  prepareQuery<Input, Output>(options: {
    readonly client: Client;
    readonly input: Input;
    readonly load: QueryLoader<Client, Input, Output>;
  }): PreparedQuery<Input, Output>;
  prepareMutation<Input, Output>(options: {
    readonly client: Client;
    readonly run: MutationRunner<Client, Input, Output>;
  }): PreparedMutation<Input, Output>;
  runSsrQuery<Input, Output>(options: {
    readonly client: Client;
    readonly input: Input;
    readonly load: QueryLoader<Client, Input, Output>;
  }): Promise<Output>;
}

/**
 * A framework issue binds its real mount/update/dispose operations to this
 * private driver. The public adapter remains free to expose hooks, signals,
 * refs, stores or resources instead of sharing a runtime state engine.
 */
export interface ConformanceQuery<Input, Output> {
  snapshot(): QuerySnapshot<Output>;
  mount(): Promise<void>;
  update(input: Input): Promise<void>;
  refresh(): Promise<void>;
  whenSettled(): Promise<void>;
  dispose(): Promise<void>;
}

export interface ConformanceMutation<Input, Output> {
  snapshot(): MutationSnapshot;
  mount(): Promise<void>;
  mutate(input: Input): Promise<Output>;
  dispose(): Promise<void>;
}

export interface AdapterConformanceBinding<Client> {
  readonly package: AdapterPackageExpectation;
  prepareQuery<Input, Output>(options: {
    readonly client: Client;
    readonly input: Input;
    readonly load: QueryLoader<Client, Input, Output>;
  }): ConformanceQuery<Input, Output>;
  prepareMutation<Input, Output>(options: {
    readonly client: Client;
    readonly run: MutationRunner<Client, Input, Output>;
  }): ConformanceMutation<Input, Output>;
  runSsrQuery<Input, Output>(options: {
    readonly client: Client;
    readonly input: Input;
    readonly load: QueryLoader<Client, Input, Output>;
  }): Promise<Output>;
}

interface Activatable {
  activate(registerCleanup: RegisterCleanup): void;
}

async function activate<Value extends Activatable>(
  lifecycle: LifecycleHarness,
  value: Value,
): Promise<ActivatedLifecycle<Value>> {
  let failure: unknown;
  let failed = false;
  const owner = await lifecycle.activate(registerCleanup => {
    try {
      value.activate(registerCleanup);
    } catch (error) {
      failed = true;
      failure = error;
    }
    return value;
  });
  if (!failed) return owner;
  await owner.dispose();
  throw failure;
}

function notMounted(packageName: string, primitive: string): Error {
  return new Error(`${packageName} ${primitive} conformance driver is not mounted`);
}

export function bindPreparedAdapterSubject<Client>(
  subject: AdapterConformanceSubject<Client>,
  lifecycle: LifecycleHarness,
): AdapterConformanceBinding<Client> {
  return {
    package: subject.package,
    prepareQuery(options) {
      const prepared = subject.prepareQuery(options);
      let owner: ActivatedLifecycle<typeof prepared> | undefined;
      let mounted = false;
      let disposed = false;

      return {
        snapshot() {
          return prepared.snapshot;
        },
        async mount() {
          if (mounted) throw new Error(`${subject.package.name} query conformance driver mounted twice`);
          if (disposed) throw new Error(`${subject.package.name} query conformance driver mounted after disposal`);
          owner = await activate(lifecycle, prepared);
          mounted = true;
        },
        async update(input) {
          if (!mounted) throw notMounted(subject.package.name, 'query');
          prepared.changeInput(input);
        },
        refresh() {
          if (!mounted) return Promise.reject(notMounted(subject.package.name, 'query'));
          return prepared.refresh();
        },
        whenSettled() {
          if (!mounted) return Promise.reject(notMounted(subject.package.name, 'query'));
          return prepared.whenSettled();
        },
        async dispose() {
          if (disposed) return;
          disposed = true;
          await owner?.dispose();
        },
      };
    },
    prepareMutation(options) {
      const prepared = subject.prepareMutation(options);
      let owner: ActivatedLifecycle<typeof prepared> | undefined;
      let mounted = false;
      let disposed = false;

      return {
        snapshot() {
          return prepared.snapshot;
        },
        async mount() {
          if (mounted) throw new Error(`${subject.package.name} mutation conformance driver mounted twice`);
          if (disposed) throw new Error(`${subject.package.name} mutation conformance driver mounted after disposal`);
          owner = await activate(lifecycle, prepared);
          mounted = true;
        },
        mutate(input) {
          if (!mounted) return Promise.reject(notMounted(subject.package.name, 'mutation'));
          return prepared.mutate(input);
        },
        async dispose() {
          if (disposed) return;
          disposed = true;
          await owner?.dispose();
        },
      };
    },
    runSsrQuery(options) {
      return subject.runSsrQuery(options);
    },
  };
}

function missing(packageName: string, boundary: string): never {
  throw new Error(`${packageName} has no ${boundary} implementation`);
}

export function unavailableAdapterSubject<Client>(
  packageExpectation: AdapterPackageExpectation,
): AdapterConformanceSubject<Client> {
  return {
    package: packageExpectation,
    prepareQuery() {
      return {
        snapshot: { data: undefined, error: undefined, loading: false },
        activate() {
          missing(packageExpectation.name, 'query primitive');
        },
        changeInput() {
          missing(packageExpectation.name, 'query input lifecycle');
        },
        refresh() {
          return Promise.reject(new Error(`${packageExpectation.name} has no query refresh implementation`));
        },
        whenSettled() {
          return Promise.reject(new Error(`${packageExpectation.name} has no query state implementation`));
        },
      };
    },
    prepareMutation() {
      return {
        snapshot: { error: undefined, pending: false },
        activate() {
          missing(packageExpectation.name, 'mutation primitive');
        },
        mutate() {
          return Promise.reject(new Error(`${packageExpectation.name} has no mutation implementation`));
        },
      };
    },
    runSsrQuery() {
      return Promise.reject(new Error(`${packageExpectation.name} has no request-scoped SSR implementation`));
    },
  };
}
