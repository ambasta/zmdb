import type { ClientResponseError } from '@zmdb/client';
import type { Equal, Expect, Extends } from '@zmdb/schema-core';

import type { ApiClient, PatchAccountsAccountIdError } from '../__fixtures__/http-client.generated.js';

interface UpdateAccountInput {
  readonly path: { readonly accountId: string };
  readonly query?: {
    readonly include?: readonly string[] | undefined;
    readonly dryRun?: boolean | undefined;
  };
  readonly headers?: { readonly requestId?: string | undefined };
  readonly cookies: { readonly session: string };
  readonly body: {
    readonly displayName: string;
    readonly metadata: Readonly<Record<string, unknown>> | null;
  };
}

type UpdateAccountResult =
  | {
      readonly status: 200;
      readonly body: { readonly id: string; readonly displayName: string };
      readonly headers: { readonly etag: string };
    }
  | {
      readonly status: 202;
      readonly body: { readonly jobId: string };
      readonly headers: Readonly<Record<never, never>>;
    }
  | {
      readonly status: 204;
      readonly body: void;
      readonly headers: Readonly<Record<never, never>>;
    };

type Input = Parameters<ApiClient['patch_accounts_accountId']>[0];
type Options = NonNullable<Parameters<ApiClient['patch_accounts_accountId']>[1]>;
type Result = Awaited<ReturnType<ApiClient['patch_accounts_accountId']>>;
type NotFound = Extract<PatchAccountsAccountIdError, ClientResponseError<404, unknown>>;

export type _generated_input_matches_the_frozen_operation = Expect<Equal<Input, UpdateAccountInput>>;
export type _generated_options_expose_only_declared_versions = Expect<Equal<Options['version'], '1' | '2' | undefined>>;
export type _generated_successes_are_the_exact_status_union = Expect<Equal<Result, UpdateAccountResult>>;
export type _generated_error_keeps_its_exact_status = Expect<Equal<NotFound['status'], 404>>;
export type _generated_error_keeps_its_decoded_body = Expect<
  Equal<NotFound['body'], { readonly code: string; readonly message: string }>
>;

type MissingPath = Omit<Input, 'path'>;
type FlatInput = Omit<Input, 'path' | 'query'> & {
  readonly accountId: string;
  readonly include: readonly string[];
};
type ArrayHeader = Omit<Input, 'headers'> & {
  readonly headers: { readonly requestId: readonly string[] };
};
type UnknownVersion = { readonly version: '3' };
type MissingEtag = {
  readonly status: 200;
  readonly body: { readonly id: string; readonly displayName: string };
  readonly headers: {};
};

export type _generated_missing_path_is_rejected = Expect<Equal<Extends<MissingPath, Input>, false>>;
export type _generated_flat_locations_are_rejected = Expect<Equal<Extends<FlatInput, Input>, false>>;
export type _generated_header_arrays_are_rejected = Expect<Equal<Extends<ArrayHeader, Input>, false>>;
export type _generated_unknown_version_is_rejected = Expect<Equal<Extends<UnknownVersion, Options>, false>>;
export type _generated_missing_response_header_is_rejected = Expect<Equal<Extends<MissingEtag, Result>, false>>;
