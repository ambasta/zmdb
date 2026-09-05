// One operation's request and response documents, asked for by type.
//
// `generated-schemas.spec.ts` runs the build transform over this file and puts the
// resulting documents into one method-specific HttpContractIR operation. The OpenAPI
// renderer receives only that IR; it never sees this declaration or reflects the types.
//
// `documents` is declared rather than defined so assignability is checked while the
// emitted values stay available to the spec, which supplies the function at evaluation.

import type { CreateDTO, ReadDTO } from '@zmdb/schema-core/derive';
import { toJsonSchema, type JsonSchemaObject } from '@zmdb/schema-core/openapi';

import type { User } from './entities.js';

interface GeneratedDocuments {
  readonly body: JsonSchemaObject;
  readonly response: JsonSchemaObject;
}

declare function documents(value: GeneratedDocuments): void;

documents({
  // The create body: no `id`, because the database makes it, and `createdAt` optional,
  // because it has a default. Both facts come from the type.
  body: toJsonSchema<CreateDTO<User>>(),
  response: toJsonSchema<ReadDTO<User>>(),
});
