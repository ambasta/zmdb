// The payload corpus: one derived DTO per variant of each table `tables.ts` describes.
//
// `payload-types.spec.ts` reflects each of these into a `TypeIR` and compares it against
// `objectTypeFromIR(ir, variant)` — the IR back-end the repository validates through. Same
// claim as `documents.ts` makes for JSON Schema, one layer down: naming a variant and naming
// a derived type have to describe the same payload, or the repository and the emitted
// validator disagree about the same `create` call.
//
// `payload` is a declaration, not a function. Nothing here runs; the spec reads the type
// argument off the call site and never evaluates the file.

import type { CreateDTO, Entity, UpdateDTO } from '@zmdb/schema-core/derive';

import type { Membership, User } from './tables.js';

declare function payload<T>(label: string, of?: T): void;

payload<Entity<User>>('users:entity');
payload<CreateDTO<User>>('users:create');
payload<UpdateDTO<User>>('users:update');

// A composite, non-serial primary key: `CreateDTO` keeps both key columns because the
// caller has to supply them, and `UpdateDTO` drops them because a patch cannot move a row.
payload<Entity<Membership>>('memberships:entity');
payload<CreateDTO<Membership>>('memberships:create');
payload<UpdateDTO<Membership>>('memberships:update');
