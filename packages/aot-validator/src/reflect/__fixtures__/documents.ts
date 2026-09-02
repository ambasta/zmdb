// The type-driven half of the JSON Schema corpus: one `toJsonSchema<T>()` per DTO of
// each table `equivalence.ts` describes, plus one shape no variant name can express.
//
// `documents.spec.ts` transforms this file and then *runs* it, supplying `document`. So
// what the assertions compare is not "the emitter would produce" but the document the
// bundle actually ships — which is the only form of REQ-TF-7 worth having.
//
// Written against the same interfaces as `equivalence.ts`, on purpose: its twin
// `equivalence-schemas.ts` is the oracle, and a document derived from `CreateDTO<User>`
// has to equal `toJsonSchema(users, 'create')` down to the byte.

import type { CreateDTO, Entity, ReadDTO, UpdateDTO } from '@zmdb/schema-core/derive';
import { toJsonSchema } from '@zmdb/schema-core/openapi';

import type { Membership, User } from './equivalence.ts';

/** Declared, not defined. The spec passes it in when it evaluates the emitted module. */
declare function document(label: string, doc: unknown): void;

document('users:entity', toJsonSchema<Entity<User>>());
document('users:create', toJsonSchema<CreateDTO<User>>());
document('users:update', toJsonSchema<UpdateDTO<User>>());
// `ReadDTO` removes the sensitive column from the *type*. The document never had it
// either way, which is the point: the emitter drops it whatever shape it is handed.
document('users:read', toJsonSchema<ReadDTO<User>>());

document('memberships:entity', toJsonSchema<Entity<Membership>>());
document('memberships:create', toJsonSchema<CreateDTO<Membership>>());
document('memberships:update', toJsonSchema<UpdateDTO<Membership>>());
document('memberships:read', toJsonSchema<ReadDTO<Membership>>());

// Said twice, to be one hoisted constant in the output rather than two.
document('users:entity:again', toJsonSchema<Entity<User>>());

// Nothing in the `'entity' | 'create' | 'update' | …` vocabulary can ask for this.
document('users:projection', toJsonSchema<Pick<Entity<User>, 'id' | 'email'>>());
