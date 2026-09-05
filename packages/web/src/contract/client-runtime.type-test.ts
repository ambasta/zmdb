import type { Equal, Expect, Extends } from '@zmdb/schema-core';

// Compile-only freeze for #680. These structural types are transcribed from
// packages/client/SPEC.md §10 because @zmdb/client has not been created. #682
// must replace them with imports from the real generated module; every rejection
// below then applies unchanged to that public surface.

interface UpdateAccountInput {
  readonly path: { readonly accountId: string };
  readonly query?: {
    readonly include?: readonly string[] | undefined;
    readonly dryRun?: boolean | undefined;
  };
  readonly headers?: { readonly requestId?: string | undefined };
  readonly cookies: { readonly session: string };
  readonly body: { readonly displayName: string; readonly metadata: Readonly<Record<string, unknown>> | null };
}

interface UpdateAccountOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly version?: '1' | '2';
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

interface UpdateAccountNotFound {
  readonly code: string;
  readonly message: string;
}

interface ClientResponseError<Status extends number, Body> extends Error {
  readonly status: Status;
  readonly body: Body;
}

interface ApiClient {
  patch_accounts_accountId(input: UpdateAccountInput, options?: UpdateAccountOptions): Promise<UpdateAccountResult>;
}

type Input = Parameters<ApiClient['patch_accounts_accountId']>[0];
type Options = NonNullable<Parameters<ApiClient['patch_accounts_accountId']>[1]>;
type Result = Awaited<ReturnType<ApiClient['patch_accounts_accountId']>>;
type NotFound = ClientResponseError<404, UpdateAccountNotFound>;

export type _input_matches_the_frozen_operation = Expect<Equal<Input, UpdateAccountInput>>;
export type _options_expose_only_declared_versions = Expect<Equal<Options['version'], '1' | '2' | undefined>>;
export type _successful_statuses_are_a_discriminated_union = Expect<Equal<Result['status'], 200 | 202 | 204>>;
export type _documented_error_keeps_its_exact_status = Expect<Equal<NotFound['status'], 404>>;
export type _documented_error_keeps_its_decoded_body = Expect<Equal<NotFound['body'], UpdateAccountNotFound>>;

type MissingPath = Omit<Input, 'path'>;
type NumericPath = Omit<Input, 'path'> & { readonly path: { readonly accountId: number } };
type FlatInput = Omit<Input, 'path' | 'query'> & {
  readonly accountId: string;
  readonly include: readonly string[];
};
type ScalarArrayQuery = Omit<Input, 'query'> & {
  readonly query: { readonly include: string };
};
type ArrayHeader = Omit<Input, 'headers'> & {
  readonly headers: { readonly requestId: readonly string[] };
};
type MissingCookie = Omit<Input, 'cookies'>;
type NullRequestBody = Omit<Input, 'body'> & { readonly body: null };
type UnknownVersion = { readonly version: '3' };

export type _missing_path_is_rejected = Expect<Equal<Extends<MissingPath, Input>, false>>;
export type _numeric_path_is_rejected = Expect<Equal<Extends<NumericPath, Input>, false>>;
export type _flat_locations_are_rejected = Expect<Equal<Extends<FlatInput, Input>, false>>;
export type _query_array_cannot_be_flattened_to_one_string = Expect<Equal<Extends<ScalarArrayQuery, Input>, false>>;
export type _header_arrays_are_rejected = Expect<Equal<Extends<ArrayHeader, Input>, false>>;
export type _required_cookie_group_is_not_optional = Expect<Equal<Extends<MissingCookie, Input>, false>>;
export type _json_null_is_not_an_empty_request_body = Expect<Equal<Extends<NullRequestBody, Input>, false>>;
export type _undeclared_version_is_rejected = Expect<Equal<Extends<UnknownVersion, Options>, false>>;

type Success200 = Extract<Result, { readonly status: 200 }>;
type Success202 = Extract<Result, { readonly status: 202 }>;
type Success204 = Extract<Result, { readonly status: 204 }>;
type UndocumentedSuccess = { readonly status: 418; readonly body: string; readonly headers: {} };
type MissingEtag = {
  readonly status: 200;
  readonly body: { readonly id: string; readonly displayName: string };
  readonly headers: {};
};
type WrongAcceptedBody = {
  readonly status: 202;
  readonly body: { readonly id: string };
  readonly headers: {};
};

export type _status_200_carries_validated_headers = Expect<Equal<Success200['headers'], { readonly etag: string }>>;
export type _status_202_has_its_own_body = Expect<Equal<Success202['body'], { readonly jobId: string }>>;
export type _status_204_has_no_body = Expect<Equal<Success204['body'], void>>;
export type _undocumented_status_is_not_a_success = Expect<Equal<Extends<UndocumentedSuccess, Result>, false>>;
export type _status_200_without_etag_is_rejected = Expect<Equal<Extends<MissingEtag, Result>, false>>;
export type _status_202_cannot_use_the_200_body = Expect<Equal<Extends<WrongAcceptedBody, Result>, false>>;
