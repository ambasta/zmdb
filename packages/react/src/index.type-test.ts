import { createZmdbReact } from '@zmdb/react';
import type {
  MutationState,
  QueryState,
  ZmdbClientProviderProps,
  ZmdbReactBindings,
  ZmdbReactRequestLifecycle,
} from '@zmdb/react';

interface Widget {
  readonly id: string;
  readonly name: string;
}

interface GeneratedClient {
  getWidget(input: { readonly id: string }, options: { readonly signal: AbortSignal }): Promise<Widget>;
  renameWidget(
    input: { readonly id: string; readonly name: string },
    options: { readonly signal: AbortSignal },
  ): Promise<Widget>;
}

const bindings = createZmdbReact<GeneratedClient>('Widgets');
const generatedClient: GeneratedClient = {
  getWidget: input => Promise.resolve({ id: input.id, name: 'Widget' }),
  renameWidget: input => Promise.resolve(input),
};

const requestLifecycle: ZmdbReactRequestLifecycle = {
  register(kind, controller) {
    kind satisfies 'mutation' | 'query';
    controller satisfies AbortController;
  },
};

const providerProps = {
  client: generatedClient,
  requestLifecycle,
} satisfies ZmdbClientProviderProps<GeneratedClient>;

function inference(react: ZmdbReactBindings<GeneratedClient>): void {
  const client = react.useZmdbClient();
  client.getWidget satisfies GeneratedClient['getWidget'];

  const query = react.useZmdbQuery((api, signal) => api.getWidget({ id: 'one' }, { signal }), ['one']);
  query satisfies QueryState<Widget>;
  query.data satisfies Widget | undefined;
  query.refresh satisfies () => Promise<void>;

  const mutation = react.useZmdbMutation((api, input: { readonly id: string; readonly name: string }, signal) =>
    api.renameWidget(input, { signal }),
  );
  mutation satisfies MutationState<{ readonly id: string; readonly name: string }, Widget>;
  mutation.mutate satisfies (input: { readonly id: string; readonly name: string }) => Promise<Widget>;

  // @ts-expect-error generated mutation input still requires a name
  void mutation.mutate({ id: 'one' });
}

bindings satisfies ZmdbReactBindings<GeneratedClient>;
void providerProps;
void inference;
