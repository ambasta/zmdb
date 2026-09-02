// A route's request and response documents, asked for by type.
//
// This is the shape a controller's OpenAPI input takes once `toJsonSchema<T>()` exists:
// no schema value, no variant string, no `as`. `generated-schemas.spec.ts` runs the build
// transform over this file and feeds the result to `toOpenApi`, which is the whole claim —
// `RouteSchemas` accepts a generated literal directly.
//
// `routes` is declared rather than defined so the assignability to `RouteSchemas` is
// checked by the compiler while the *value* stays available to the spec, which supplies
// the function when it evaluates the emitted module.

import type { CreateDTO, ReadDTO } from '@zmdb/schema-core/derive';
import { toJsonSchema } from '@zmdb/schema-core/openapi';

import type { RouteSchemas } from '../index.ts';
import type { User } from './entities.ts';

declare function routes(schemas: Readonly<Record<string, RouteSchemas>>): void;

routes({
  '/users': {
    // The create body: no `id`, because the database makes it, and `createdAt` optional,
    // because it has a default. Both facts come from the type.
    body: toJsonSchema<CreateDTO<User>>(),
    response: toJsonSchema<ReadDTO<User>>(),
  },
});
