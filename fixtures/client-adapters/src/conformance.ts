import type { RegisterCleanup } from './lifecycles.js';
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
