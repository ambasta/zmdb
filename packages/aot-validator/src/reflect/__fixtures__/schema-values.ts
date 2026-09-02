// The type-driven half of the *schema value* corpus: `schemaOf<T>()` for each table
// `equivalence.ts` describes.
//
// `schema-values.spec.ts` transforms this file and then runs it, supplying `schema`. So
// what the assertions compare is not "the emitter would produce" but the object the
// bundle actually ships — which is the only form of REQ-TF-10 worth having, because that
// object is what `defineRepository` compiles SQL from.

import { schemaOf } from '@zmdb/schema-core';

import type { Membership, User } from './equivalence.ts';

/** Declared, not defined. The spec passes it in when it evaluates the emitted module. */
declare function schema(label: string, value: unknown): void;

schema('users', schemaOf<User>());
schema('memberships', schemaOf<Membership>());

// Said twice, to be one hoisted constant in the output rather than two.
schema('users:again', schemaOf<User>());
