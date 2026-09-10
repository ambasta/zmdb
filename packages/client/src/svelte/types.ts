// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Readable } from 'svelte/store';

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

export interface SvelteQueryStore<Output> extends Readable<QuerySnapshot<Output>> {
  refresh(): Promise<void>;
  destroy(): void;
}

export interface SvelteMutationStore<Input, Output> extends Readable<MutationSnapshot> {
  mutate(input: Input): Promise<Output>;
  destroy(): void;
}

export interface ZmdbSvelteBindings<Client> {
  getClient(): Client;
  setClient(client: Client): Client;
  hasClient(): boolean;
  query<Input, Output>(
    input: Input | Readable<Input>,
    load: QueryLoader<Client, Input, Output>,
  ): SvelteQueryStore<Output>;
  mutation<Input, Output>(run: MutationRunner<Client, Input, Output>): SvelteMutationStore<Input, Output>;
}
