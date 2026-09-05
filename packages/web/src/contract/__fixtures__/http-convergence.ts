import type { TypeIR } from '@zmdb/schema-core/ir';

import { Controller, Get, Patch, Post, Public } from '../../routing/index.js';
import { Version } from '../../versioning/index.js';
import { defineHttpContract, httpOperation } from '../index.js';

interface UpdateMetadata {
  readonly source: string;
}

interface UpdateAccountBody {
  readonly displayName: string;
  readonly metadata: UpdateMetadata | null;
}

interface Account {
  readonly id: string;
  readonly displayName: string;
}

interface AcceptedUpdate {
  readonly jobId: string;
}

interface Problem {
  readonly code: string;
  readonly message: string;
}

interface UpdateAccountOperation {
  readonly path: { readonly accountId: string };
  readonly query: { readonly include?: readonly string[]; readonly dryRun?: boolean };
  readonly headers: { readonly requestId?: string };
  readonly cookies: { readonly session: string };
  readonly body: UpdateAccountBody;
  readonly responses: {
    readonly 200: { readonly body: Account; readonly headers: { readonly etag: string } };
    readonly 202: { readonly body: AcceptedUpdate };
    readonly 204: { readonly body: void };
    readonly 404: { readonly body: Problem };
  };
}

@Version('1', '2')
@Controller('/accounts')
export class AccountsController {
  @Patch('/:accountId')
  update() {
    return { updated: true };
  }
}

export const HTTP_CONTRACT = defineHttpContract({
  securitySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer' },
    apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
  },
  operations: {
    patch_accounts_accountId: httpOperation<UpdateAccountOperation>({
      controller: AccountsController,
      handler: 'update',
      method: 'PATCH',
      path: '/accounts/:accountId',
      parameters: [
        { in: 'path', property: 'accountId', name: 'accountId' },
        { in: 'query', property: 'include', name: 'include' },
        { in: 'query', property: 'dryRun', name: 'dry-run' },
        { in: 'header', property: 'requestId', name: 'x-request-id' },
        { in: 'cookie', property: 'session', name: 'session' },
      ],
      requestBody: { kind: 'json', mediaType: 'application/json', required: true },
      responses: {
        200: {
          description: 'Updated',
          headers: [{ property: 'etag', name: 'etag' }],
          body: { kind: 'json', mediaType: 'application/json' },
        },
        202: {
          description: 'Accepted',
          body: { kind: 'json', mediaType: 'application/json' },
        },
        204: {
          description: 'No change',
          body: { kind: 'empty' },
        },
        404: {
          description: 'Account not found',
          body: { kind: 'json', mediaType: 'application/problem+json' },
        },
      },
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      version: {
        kind: 'header',
        name: 'accept-version',
        values: ['1', '2'],
        default: '1',
      },
      deprecated: true,
    }),
  },
});

interface ReadSharedOperation {
  readonly path: { readonly id: string };
  readonly responses: { readonly 200: { readonly body: Account } };
}

interface WriteSharedOperation {
  readonly path: { readonly id: string };
  readonly responses: { readonly 202: { readonly body: AcceptedUpdate } };
}

@Controller('/shared')
export class SharedPathController {
  @Public()
  @Get('/:id')
  read() {
    return { id: 'shared', displayName: 'Shared' };
  }

  @Public()
  @Post('/:id')
  write() {
    return { jobId: 'job-shared' };
  }
}

export const SHARED_PATH_CONTRACT = defineHttpContract({
  securitySchemes: {},
  operations: {
    post_shared_id: httpOperation<WriteSharedOperation>({
      controller: SharedPathController,
      handler: 'write',
      method: 'POST',
      path: '/shared/:id',
      parameters: [{ in: 'path', property: 'id', name: 'id' }],
      responses: {
        202: {
          description: 'Accepted',
          body: { kind: 'json', mediaType: 'application/json' },
        },
      },
      security: [],
      version: { kind: 'none' },
      deprecated: false,
    }),
    get_shared_id: httpOperation<ReadSharedOperation>({
      controller: SharedPathController,
      handler: 'read',
      method: 'GET',
      path: '/shared/:id',
      parameters: [{ in: 'path', property: 'id', name: 'id' }],
      responses: {
        200: {
          description: 'OK',
          body: { kind: 'json', mediaType: 'application/json' },
        },
      },
      security: [],
      version: { kind: 'none' },
      deprecated: false,
    }),
  },
});

interface CollisionOperation {
  readonly path: { readonly id: string };
  readonly responses: { readonly 200: { readonly body: Account } };
}

@Controller('/collision')
export class CollisionController {
  @Public()
  @Get('/:id')
  first() {
    return { id: 'first', displayName: 'First' };
  }

  @Public()
  @Get('/:id')
  second() {
    return { id: 'second', displayName: 'Second' };
  }
}

export const COLLIDING_ROUTE_CONTRACT = defineHttpContract({
  securitySchemes: {},
  operations: {
    z_collision_first: httpOperation<CollisionOperation>({
      controller: CollisionController,
      handler: 'first',
      method: 'GET',
      path: '/collision/:id',
      parameters: [{ in: 'path', property: 'id', name: 'id' }],
      responses: {
        200: { description: 'First', body: { kind: 'json', mediaType: 'application/json' } },
      },
      security: [],
      version: { kind: 'none' },
      deprecated: false,
    }),
    a_collision_second: httpOperation<CollisionOperation>({
      controller: CollisionController,
      handler: 'second',
      method: 'GET',
      path: '/collision/:id',
      parameters: [{ in: 'path', property: 'id', name: 'id' }],
      responses: {
        200: { description: 'Second', body: { kind: 'json', mediaType: 'application/json' } },
      },
      security: [],
      version: { kind: 'none' },
      deprecated: false,
    }),
  },
});

const DYNAMIC_ROUTE_PATH = '/dynamic/:id';

@Controller('/dynamic')
export class DynamicController {
  @Public()
  @Get('/:id')
  read() {
    return { id: 'dynamic', displayName: 'Dynamic' };
  }
}

export const DYNAMIC_METADATA_CONTRACT = defineHttpContract({
  securitySchemes: {},
  operations: {
    get_dynamic_id: httpOperation<CollisionOperation>({
      controller: DynamicController,
      handler: 'read',
      method: 'GET',
      path: DYNAMIC_ROUTE_PATH,
      parameters: [{ in: 'path', property: 'id', name: 'id' }],
      responses: {
        200: { description: 'Dynamic', body: { kind: 'json', mediaType: 'application/json' } },
      },
      security: [],
      version: { kind: 'none' },
      deprecated: false,
    }),
  },
});

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

interface HttpTypeFixture {
  readonly type: TypeIR;
  readonly openApi: Readonly<Record<string, JsonValue>>;
}

interface HttpParameterFixture {
  readonly property: string;
  readonly name: string;
  readonly in: 'path' | 'query' | 'header' | 'cookie';
  readonly required: boolean;
  readonly typeId: string;
}

type HttpBodyFixture =
  | { readonly kind: 'json'; readonly mediaType: string; readonly typeId: string }
  | { readonly kind: 'text' | 'bytes' | 'stream'; readonly mediaType: string }
  | { readonly kind: 'empty' };

interface HttpResponseFixture {
  readonly status: number;
  readonly description: string;
  readonly headers: readonly {
    readonly property: string;
    readonly name: string;
    readonly required: boolean;
    readonly typeId: string;
  }[];
  readonly body: HttpBodyFixture;
}

interface HttpContractFixture {
  readonly format: 1;
  readonly types: Readonly<Record<string, HttpTypeFixture>>;
  readonly operations: readonly [
    {
      readonly operationId: 'patch_accounts_accountId';
      readonly controller: 'AccountsController';
      readonly handler: 'update';
      readonly method: 'PATCH';
      readonly path: '/accounts/:accountId';
      readonly parameters: readonly HttpParameterFixture[];
      readonly requestBody: {
        readonly kind: 'json';
        readonly mediaType: 'application/json';
        readonly typeId: 'patch_accounts_accountId/request/body';
        readonly required: true;
      };
      readonly responses: readonly HttpResponseFixture[];
      readonly security: readonly [
        Readonly<Record<'bearerAuth', readonly string[]>>,
        Readonly<Record<'apiKeyAuth', readonly string[]>>,
      ];
      readonly version: {
        readonly kind: 'header';
        readonly name: 'accept-version';
        readonly values: readonly ['1', '2'];
        readonly default: '1';
      };
      readonly deprecated: true;
    },
  ];
  readonly securitySchemes: {
    readonly bearerAuth: { readonly type: 'http'; readonly scheme: 'bearer' };
    readonly apiKeyAuth: { readonly type: 'apiKey'; readonly in: 'header'; readonly name: 'x-api-key' };
  };
}

const STRING: TypeIR = { kind: 'scalar', scalar: 'string' };
const BOOLEAN: TypeIR = { kind: 'scalar', scalar: 'boolean' };
const STRING_ARRAY: TypeIR = { kind: 'array', element: STRING };
const UPDATE_BODY: TypeIR = {
  kind: 'object',
  name: 'UpdateAccountBody',
  properties: [
    { name: 'displayName', type: STRING, optional: false, readonly: true },
    {
      name: 'metadata',
      type: { kind: 'union', members: [{ kind: 'object', properties: [] }, { kind: 'null' }] },
      optional: false,
      readonly: true,
    },
  ],
};
const ACCOUNT: TypeIR = {
  kind: 'object',
  name: 'Account',
  properties: [
    { name: 'id', type: STRING, optional: false, readonly: true },
    { name: 'displayName', type: STRING, optional: false, readonly: true },
  ],
};
const ACCEPTED: TypeIR = {
  kind: 'object',
  name: 'AcceptedUpdate',
  properties: [{ name: 'jobId', type: STRING, optional: false, readonly: true }],
};
const PROBLEM: TypeIR = {
  kind: 'object',
  name: 'Problem',
  properties: [
    { name: 'code', type: STRING, optional: false, readonly: true },
    { name: 'message', type: STRING, optional: false, readonly: true },
  ],
};

export const REQUEST_BODY_SCHEMA = {
  type: 'object',
  required: ['displayName', 'metadata'],
  properties: {
    displayName: { type: 'string' },
    metadata: { type: ['object', 'null'], additionalProperties: true },
  },
} satisfies Readonly<Record<string, JsonValue>>;

export const SUCCESS_BODY_SCHEMA = {
  type: 'object',
  required: ['id', 'displayName'],
  properties: {
    id: { type: 'string' },
    displayName: { type: 'string' },
  },
} satisfies Readonly<Record<string, JsonValue>>;

export const HTTP_CONVERGENCE_FIXTURE = {
  contract: {
    format: 1,
    types: {
      'patch_accounts_accountId/parameter/path/accountId': {
        type: STRING,
        openApi: { type: 'string' },
      },
      'patch_accounts_accountId/parameter/query/include': {
        type: STRING_ARRAY,
        openApi: { type: 'array', items: { type: 'string' } },
      },
      'patch_accounts_accountId/parameter/query/dryRun': {
        type: BOOLEAN,
        openApi: { type: 'boolean' },
      },
      'patch_accounts_accountId/parameter/header/requestId': {
        type: STRING,
        openApi: { type: 'string' },
      },
      'patch_accounts_accountId/parameter/cookie/session': {
        type: STRING,
        openApi: { type: 'string' },
      },
      'patch_accounts_accountId/request/body': {
        type: UPDATE_BODY,
        openApi: REQUEST_BODY_SCHEMA,
      },
      'patch_accounts_accountId/response/200/body': {
        type: ACCOUNT,
        openApi: SUCCESS_BODY_SCHEMA,
      },
      'patch_accounts_accountId/response/200/header/etag': {
        type: STRING,
        openApi: { type: 'string' },
      },
      'patch_accounts_accountId/response/202/body': {
        type: ACCEPTED,
        openApi: {
          type: 'object',
          required: ['jobId'],
          properties: { jobId: { type: 'string' } },
        },
      },
      'patch_accounts_accountId/response/404/body': {
        type: PROBLEM,
        openApi: {
          type: 'object',
          required: ['code', 'message'],
          properties: { code: { type: 'string' }, message: { type: 'string' } },
        },
      },
    },
    operations: [
      {
        operationId: 'patch_accounts_accountId',
        controller: 'AccountsController',
        handler: 'update',
        method: 'PATCH',
        path: '/accounts/:accountId',
        parameters: [
          {
            property: 'accountId',
            name: 'accountId',
            in: 'path',
            required: true,
            typeId: 'patch_accounts_accountId/parameter/path/accountId',
          },
          {
            property: 'include',
            name: 'include',
            in: 'query',
            required: false,
            typeId: 'patch_accounts_accountId/parameter/query/include',
          },
          {
            property: 'dryRun',
            name: 'dry-run',
            in: 'query',
            required: false,
            typeId: 'patch_accounts_accountId/parameter/query/dryRun',
          },
          {
            property: 'requestId',
            name: 'x-request-id',
            in: 'header',
            required: false,
            typeId: 'patch_accounts_accountId/parameter/header/requestId',
          },
          {
            property: 'session',
            name: 'session',
            in: 'cookie',
            required: true,
            typeId: 'patch_accounts_accountId/parameter/cookie/session',
          },
        ],
        requestBody: {
          kind: 'json',
          mediaType: 'application/json',
          typeId: 'patch_accounts_accountId/request/body',
          required: true,
        },
        responses: [
          {
            status: 200,
            description: 'Updated',
            headers: [
              {
                property: 'etag',
                name: 'etag',
                required: true,
                typeId: 'patch_accounts_accountId/response/200/header/etag',
              },
            ],
            body: {
              kind: 'json',
              mediaType: 'application/json',
              typeId: 'patch_accounts_accountId/response/200/body',
            },
          },
          {
            status: 202,
            description: 'Accepted',
            headers: [],
            body: {
              kind: 'json',
              mediaType: 'application/json',
              typeId: 'patch_accounts_accountId/response/202/body',
            },
          },
          {
            status: 204,
            description: 'No change',
            headers: [],
            body: { kind: 'empty' },
          },
          {
            status: 404,
            description: 'Account not found',
            headers: [],
            body: {
              kind: 'json',
              mediaType: 'application/problem+json',
              typeId: 'patch_accounts_accountId/response/404/body',
            },
          },
        ],
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        version: {
          kind: 'header',
          name: 'accept-version',
          values: ['1', '2'],
          default: '1',
        },
        deprecated: true,
      },
    ],
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    },
  } satisfies HttpContractFixture,
  input: {
    path: { accountId: 'acct/blue?draft#1' },
    query: { include: ['roles & permissions', 'teams'], dryRun: undefined },
    headers: { requestId: 'request-680' },
    cookies: { session: 'session value' },
    body: { displayName: 'Ada', metadata: null },
  },
  expectedRequest: {
    path: '/accounts/acct%2Fblue%3Fdraft%231',
    query: [
      { name: 'include', value: 'roles & permissions' },
      { name: 'include', value: 'teams' },
    ],
    headers: { 'x-request-id': 'request-680' },
    cookies: [{ name: 'session', value: 'session value' }],
    body: '{"displayName":"Ada","metadata":null}',
    version: '2',
  },
  bodyKinds: [
    { kind: 'json', mediaType: 'application/json' },
    { kind: 'text', mediaType: 'text/plain' },
    { kind: 'bytes', mediaType: 'application/octet-stream' },
    { kind: 'stream', mediaType: 'application/x-ndjson' },
    { kind: 'empty' },
  ],
} as const;

export type FrozenHttpContract = typeof HTTP_CONVERGENCE_FIXTURE.contract;
export type FrozenHttpOperation = FrozenHttpContract['operations'][number];
