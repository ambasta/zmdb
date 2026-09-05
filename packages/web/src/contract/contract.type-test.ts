import type { Equal, Expect, Extends } from '@zmdb/schema-core';
import {
  defineHttpContract,
  httpOperation,
  type HttpOperationDeclaration,
  type HttpParameterDeclaration,
} from '@zmdb/web/contract';

interface ContractTypes {
  readonly path: { readonly id: string };
  readonly query: { readonly expand?: readonly string[] };
  readonly body: { readonly name: string };
  readonly responses: {
    readonly 200: { readonly body: { readonly id: string; readonly name: string } };
    readonly 404: { readonly body: { readonly message: string } };
  };
}

class ContractController {
  update() {}
  notAHandler = 'value';
}

const operation = httpOperation<ContractTypes>({
  controller: ContractController,
  handler: 'update',
  method: 'PUT',
  path: '/contracts/:id',
  parameters: [
    { in: 'path', property: 'id', name: 'id' },
    { in: 'query', property: 'expand', name: 'expand' },
  ],
  requestBody: { kind: 'json', mediaType: 'application/json', required: true },
  responses: {
    200: { description: 'Updated', body: { kind: 'json', mediaType: 'application/json' } },
    404: { description: 'Missing', body: { kind: 'json', mediaType: 'application/problem+json' } },
  },
  security: [],
  version: { kind: 'none' },
  deprecated: false,
});

export const TYPE_TEST_CONTRACT = defineHttpContract({
  operations: { put_contract_id: operation },
  securitySchemes: {},
});

type Declaration = HttpOperationDeclaration<ContractTypes, typeof ContractController, 'update'>;
type WrongHandler = Omit<Declaration, 'handler'> & { readonly handler: 'notAHandler' };
type PathParameter = Extract<HttpParameterDeclaration<ContractTypes>, { readonly in: 'path' }>;
type QueryParameter = Extract<HttpParameterDeclaration<ContractTypes>, { readonly in: 'query' }>;

export type _handler_can_be_tied_to_a_callable_instance_key = Expect<Equal<Declaration['handler'], 'update'>>;
export type _non_handler_key_is_rejected = Expect<Equal<Extends<WrongHandler, Declaration>, false>>;
export type _path_property_comes_from_the_path_group = Expect<Equal<PathParameter['property'], 'id'>>;
export type _query_property_comes_from_the_query_group = Expect<Equal<QueryParameter['property'], 'expand'>>;
export type _responses_are_the_exact_declared_statuses = Expect<Equal<keyof Declaration['responses'], 200 | 404>>;

httpOperation<ContractTypes>({
  ...operation,
  // @ts-expect-error — path declarations can name only properties in the path group.
  parameters: [{ in: 'path', property: 'missing', name: 'id' }],
});

httpOperation<ContractTypes>({
  ...operation,
  // @ts-expect-error — every exact generic response status needs metadata.
  responses: {
    200: { description: 'Updated', body: { kind: 'json', mediaType: 'application/json' } },
  },
});
