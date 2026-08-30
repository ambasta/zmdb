import { describe, it, expectTypeOf } from 'vitest';

import type { RelationMeta, PopulatedEntity } from './index.ts';

// #32: compile-time relation type derivation. Type-level tests (TDD).
// PopulatedEntity<Base, Relations, K> augments Base with the related entity
// type for each populated key K.

interface Post {
  id: number;
  title: string;
}
interface User {
  id: number;
}

// A relations map: 'posts' is a to-many relation to Post.
// (Use a `type` alias so it carries an implicit string index signature.)
type UserRelations = {
  posts: { meta: RelationMeta; entity: Post; cardinality: 'one-to-many' };
};

describe('PopulatedEntity type derivation', () => {
  it('attaches a to-many relation as an array only when populated', () => {
    type Populated = PopulatedEntity<User, UserRelations, 'posts'>;
    expectTypeOf<Populated['posts']>().toEqualTypeOf<Post[]>();
    // Base keys remain.
    expectTypeOf<Populated['id']>().toEqualTypeOf<number>();
  });

  it('does not attach unpopulated relations', () => {
    type Unpopulated = PopulatedEntity<User, UserRelations, never>;
    // @ts-expect-error - posts is not present when not populated
    type _ = Unpopulated['posts'];
  });
});
