Define one HTTP contract, register that contract with the server, and emit two sibling build artifacts from it:

```text
account.contract.ts
        │
        ├── compileHttpContracts(...) ──> @zmdb/web runtime routing
        │
        └── zmdb client generate
                 ├──> generated/openapi.json
                 └──> generated/http-client.generated.ts ──> @zmdb/client
```

OpenAPI is an output beside the generated client. It is never the input to client generation, and zmdb does not parse an arbitrary OpenAPI document into a client.

<!-- generated-client-operation-ids: get_fixture_account -->

## 1. Declare the operation once

The operation key is the public operation ID. Method, path, parameters, exact response statuses, security, versioning, and deprecation are values; request and response application types are the
generic contract.

```ts
// docs-file: src/metadata.ts
if (Symbol.metadata === undefined) {
  Object.defineProperty(Symbol, 'metadata', {
    value: Symbol.for('Symbol.metadata'),
    configurable: true,
  });
}
```

```ts
// docs-file: src/account.contract.ts
import { Controller, type Ctx, Get, json } from '@zmdb/web';
import { defineHttpContract, httpOperation } from '@zmdb/web/contract';

import './metadata.js';

interface Account {
  readonly id: string;
  readonly displayName: string;
  readonly authenticated: boolean;
}

interface AcceptedAccount {
  readonly jobId: string;
  readonly authenticated: boolean;
}

interface GetAccountOperation {
  readonly path: { readonly accountId: string };
  readonly responses: {
    readonly 200: { readonly body: Account };
    readonly 202: { readonly body: AcceptedAccount };
  };
}

@Controller('/accounts')
export class AccountController {
  @Get('/:accountId')
  getAccount(ctx: Ctx<{ readonly accountId: string }>) {
    const authenticated = ctx.headers.authorization === 'Bearer fixture-token';
    if (ctx.params.accountId === 'accepted') {
      return json({ jobId: 'job-accepted', authenticated }, { status: 202 });
    }
    return json({
      id: ctx.params.accountId,
      displayName: `Account ${ctx.params.accountId}`,
      authenticated,
    });
  }
}

export const ACCOUNT_HTTP_CONTRACT = defineHttpContract({
  securitySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer' },
  },
  operations: {
    get_fixture_account: httpOperation<GetAccountOperation>({
      controller: AccountController,
      handler: 'getAccount',
      method: 'GET',
      path: '/accounts/:accountId',
      parameters: [{ in: 'path', property: 'accountId', name: 'accountId' }],
      responses: {
        200: {
          description: 'Account',
          body: { kind: 'json', mediaType: 'application/json' },
        },
        202: {
          description: 'Accepted',
          body: { kind: 'json', mediaType: 'application/json' },
        },
      },
      security: [{ bearerAuth: [] }],
      version: { kind: 'none' },
      deprecated: false,
    }),
  },
});
```

The declaration is inert. Calling `defineHttpContract` performs no reflection, route registration, file access, or network work.

## 2. Bind the same contract to runtime routing

The compiler uses one caller-owned `ReflectSession` to recover the generic application types and produce one `HttpContractIR`. `registerContract` binds those compiled operations to controller
instances and checks that the live route, guard, security, and version declarations agree.

```ts
// docs-file: src/runtime.ts
import { fileURLToPath } from 'node:url';

import { ReflectSession } from '@zmdb/compiler/reflect';
import { createRouter, type Guard } from '@zmdb/web';
import { compileHttpContracts } from '@zmdb/web/contract/compiler';

import { ACCOUNT_HTTP_CONTRACT, AccountController } from './account.contract.js';

const session = ReflectSession.open({ project: fileURLToPath(new URL('../tsconfig.json', import.meta.url)) });
const compiled = compileHttpContracts(
  [
    {
      file: new URL('./account.contract.ts', import.meta.url),
      exportName: 'ACCOUNT_HTTP_CONTRACT',
      contract: ACCOUNT_HTTP_CONTRACT,
    },
  ],
  { session },
);
session.close();

const operation = compiled.ir.operations.find(candidate => candidate.operationId === 'get_fixture_account');
if (operation === undefined) throw new Error('missing get_fixture_account');

const bearerGuard: Guard = {
  canActivate: ctx => ctx.headers.authorization === 'Bearer fixture-token',
};

export const router = createRouter();
router.registerContract(compiled, [new AccountController()], {
  AccountController: {
    getAccount: {
      guards: [bearerGuard],
      security: operation.security,
    },
  },
});
```

The repository's packed fixture uses this boundary to serve a real loopback `@zmdb/web` application. The client examples below are then bundled once for Node and once for a browser and call that
service.

## 3. Configure the sibling outputs

Point the canonical CLI at the exported contract and name both committed artifacts:

```ts
// docs-file: zmdb.config.ts
import { defineConfig } from 'zmdb/config';

export default defineConfig({
  schema: './src/schema.ts',
  dialect: 'sqlite',
  project: './tsconfig.json',
  http: {
    contracts: './src/account.contract.ts#ACCOUNT_HTTP_CONTRACT',
    openApi: { out: './generated/openapi.json' },
    client: { out: './generated/http-client.generated.ts' },
  },
});
```

```bash
npx zmdb client generate
npx zmdb client generate --check
npx zmdb client generate --watch
```

One command load feeds both emitters and verifies that their operation-ID sets are identical before writing. Normal generation atomically replaces only byte-different files. `--check` writes nothing
and exits non-zero when either artifact is missing or stale. `--watch` retains one reflection session and regenerates only after a source in the last compiled contract dependency set changes; it
cannot be combined with `--check` or `--json`.

Commit the `.json` and `.ts` outputs. Run `--check` in CI. Base URLs, credentials, authentication providers, timeouts, retries, and deployment environments are runtime inputs and do not belong in
`zmdb.config.ts` or generated source.

## 4. Use the generated client

The generated module contains operation-specific input and result types, request planning, exact status dispatch, and precomputed response validators. Its only runtime package import is
`@zmdb/client`.

Authentication is injected when constructing the client or overridden for one call. The provider receives the selected operation ID, declared alternatives and schemes, version, and cancellation
signal. It returns one exact header/query/cookie patch. Credentials are caller-produced per request; zmdb does not generate them, place them in generated source or errors, or retain them after request
construction.

```ts
// docs-file: src/generated-client.ts
import { createApiClient } from '../generated/http-client.generated.js';

export function accountClient(baseUrl: string | URL, token: () => string) {
  return createApiClient({
    baseUrl,
    authentication: context => {
      if (context.operationId !== 'get_fixture_account') {
        throw new Error(`unexpected operation ${context.operationId}`);
      }
      return {
        requirement: 0,
        headers: { authorization: `Bearer ${token()}` },
      };
    },
  });
}
```

### Responses, errors, and cancellation

Several successful statuses produce a status-discriminated result union. A successful JSON body is parsed and validated before the promise resolves. A declared non-2xx response is thrown as a typed
`ClientResponseError`. An undeclared status, invalid content type, invalid JSON, invalid successful body, oversized response, authentication failure, transport failure, and timeout map to distinct
stable error classes. A caller abort instead rejects with the caller's original reason.

Pass a caller-owned `AbortSignal` and/or `timeoutMs` per call. The first abort reason wins. The runtime never aborts the caller's controller, never assigns a retry policy, and clears its own timeout
on every settle path.

```ts
// docs-file: src/responses.ts
import {
  AuthenticationError,
  ClientResponseError,
  ClientTimeoutError,
  ResponseDecodeError,
  ResponseTooLargeError,
  ResponseValidationError,
  TransportError,
  UnexpectedContentTypeError,
  UnexpectedStatusError,
} from '@zmdb/client';

import { accountClient } from './generated-client.js';

const client = accountClient('https://api.example.com', () => process.env.API_TOKEN ?? '');

export async function loadAccount(accountId: string, signal: AbortSignal): Promise<string> {
  try {
    const result = await client.get_fixture_account(
      { path: { accountId } },
      {
        signal,
        timeoutMs: 5_000,
      },
    );

    switch (result.status) {
      case 200:
        return result.body.displayName;
      case 202:
        return `queued:${result.body.jobId}`;
    }
  } catch (error) {
    if (error instanceof ClientResponseError) {
      console.error(error.operationId, error.status, error.body);
    } else if (error instanceof ResponseValidationError) {
      console.error(error.operationId, error.status, error.issues);
    } else if (error instanceof ResponseDecodeError || error instanceof ResponseTooLargeError || error instanceof UnexpectedContentTypeError) {
      console.error(error.operationId, error.status, error.message);
    } else if (error instanceof ClientTimeoutError) {
      console.error(error.operationId, error.timeoutMs);
    } else if (error instanceof AuthenticationError || error instanceof TransportError || error instanceof UnexpectedStatusError) {
      console.error(error.operationId, error.message);
    }
    throw error;
  }
}
```

### Versions

Version behavior is generated from the same operation:

- an unversioned or neutral operation has no `version` call option;
- a header-versioned operation accepts only its declared literal versions and uses the declared default when omitted;
- a media-type-versioned operation gets the same exact option plus version-specific successful result overloads; and
- path versions are separate operations with separate public paths and operation IDs.

Supplying an unknown version fails before transport execution. OpenAPI receives the matching enum/default, media type, or expanded path from the sibling IR projection.

### Browser

An origin-relative base URL is valid for browser Fetch and custom browser transports:

```ts
// docs-file: src/browser.ts
import { accountClient } from './generated-client.js';

const client = accountClient('/api', () => sessionStorage.getItem('access-token') ?? '');
const controller = new AbortController();

export const browserAccount = client.get_fixture_account({ path: { accountId: 'browser' } }, { signal: controller.signal });
```

### Node

Node's Fetch requires an absolute base URL:

```ts
// docs-file: src/node.ts
import { accountClient } from './generated-client.js';

const client = accountClient('https://api.example.com', () => process.env.API_TOKEN ?? '');

export const nodeAccount = client.get_fixture_account(
  { path: { accountId: 'node' } },
  {
    signal: AbortSignal.timeout(5_000),
  },
);
```

The packed fixture compiles the examples against installed declarations with no TypeScript `paths` mapping. Its runtime proof installs only packed `@zmdb/client` beside the generated module, bundles
the same consumer for browser and Node, and exercises authentication, 200 and 202 results, and invalid-success-body rejection against the real loopback server. Focused `@zmdb/client` runtime tests
separately prove caller-abort reason identity and timeout behavior.

## 5. Manual `@zmdb/client` usage is a different path

`@zmdb/client` is independently usable without generated code, but the manual boundary is intentionally low level: you provide a `GeneratedOperation` containing the request plan and response reader.
This is useful for a small hand-authored operation or a custom transport contract. It does not infer application types, inspect controllers, parse OpenAPI, or create an SDK.

```ts
// docs-file: src/manual-client.ts
import { CLIENT_RUNTIME_ABI, createClientRuntime, type DecodeResult, type GeneratedOperation } from '@zmdb/client';

interface Health {
  readonly ok: boolean;
}

function decodeHealth(wire: unknown): DecodeResult<Health> {
  if (typeof wire === 'object' && wire !== null && !Array.isArray(wire) && Reflect.get(wire, 'ok') === true) {
    return { ok: true, value: { ok: true } };
  }
  return {
    ok: false,
    issues: [{ path: 'input.ok', message: 'expected true' }],
  };
}

const getHealth: GeneratedOperation<undefined, Health> = {
  abi: CLIENT_RUNTIME_ABI,
  operationId: 'get_health',
  method: 'GET',
  security: [],
  schemes: {},
  version: { kind: 'none' },
  prepare() {
    return {
      path: '/health',
      query: [],
      headers: { accept: 'application/json' },
      cookies: [],
    };
  },
  async read(response) {
    if (response.status !== 200) return response.unexpectedStatus();
    return response.body.json('application/json', decodeHealth);
  },
};

const runtime = createClientRuntime({ baseUrl: 'https://api.example.com' });

export function health(signal?: AbortSignal): Promise<Health> {
  return runtime.call(getHealth, undefined, signal === undefined ? {} : { signal });
}
```

For an API you own, prefer the generated workflow because it keeps runtime routing, OpenAPI, client types, and response validation on one contract. For an unrelated third-party API, use the manual
runtime boundary, a small policy-owning Fetch wrapper, or that provider's supported SDK; do not feed its OpenAPI document into zmdb.

---

See also: [Client Applications](./framework-integrations.html) · [HTTP contracts and third-party clients](./web-http-client.html) · [OpenAPI Generation](./web-openapi.html) ·
[Operations & Responses](./web-openapi-operations.html) · [Security Schemes](./web-openapi-security.html) · [API Versioning](./web-versioning.html) · [CLI Overview](./cli-overview.html)
