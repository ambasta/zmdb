Sequelize models are classes with instance methods and a runtime-declared schema. The zmdb equivalent is a TypeScript interface plus a repository, and none of the instance methods survive.

## Model → entity interface

```js
// Sequelize
const User = sequelize.define('User', {
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
});
```

```ts
// zmdb
import type { HasDefault, PrimaryKey, Serial, Sql, Table, Unique } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Unique;
  active: boolean & HasDefault;
}
```

Two things move rather than translate. The type is declared once and everything else is
derived from it, so there is no `DataTypes` import and no second object to keep in step.
And `defaultValue: true` becomes `HasDefault` plus a DDL default: the tag says the column
_has_ a default, not which one, because a default is a runtime value and no type holds one.

```sql
ALTER TABLE "users" ALTER COLUMN "active" SET DEFAULT true;
```

Sequelize adds `id`, `createdAt` and `updatedAt` for you. zmdb adds nothing — every column in the table is a property on the interface, because the interface is what generates the DDL and the DTOs. Being implicit about columns is how the DTO and the table drift apart.

> [!NOTE]
> If you are migrating an existing Sequelize database, the catalog reader and
> `emitDeclarations()` now produce one reviewed interface per table, including timestamp
> properties and comments for database defaults. Unrepresentable columns are omitted with
> structural warnings and matching `TODO` comments. The `pull` command has not landed, so
> invoke the library from a small script; see [pull](./cli-pull.html).

## Query methods

| Sequelize                                 | zmdb                                     |
| ----------------------------------------- | ---------------------------------------- |
| `User.findByPk(id)`                       | `repo.findById(id)`                      |
| `User.findOne({ where })`                 | `repo.findOne(where)`                    |
| `User.findAll({ where })`                 | `repo.find(where)`                       |
| `User.findAndCountAll({ limit, offset })` | `repo.list({ page: { limit, offset } })` |
| `User.create(values)`                     | `repo.create(dto)`                       |
| `User.update(values, { where })`          | `repo.update(id, patch)`                 |
| `User.destroy({ where })`                 | `repo.delete(id)`                        |
| `User.upsert(values)`                     | — see [Upsert](./upsert.html)            |
| `instance.save()`                         | — rows are plain data                    |
| `instance.reload()`                       | `repo.findById(id)`                      |

`findAndCountAll` mapping to `list` is not a rename, and the difference will bite if you assume it is. `list` returns `ListResult<Row>` — `{ items, hasMore, total?, cursor? }` — and it takes the same `where` / `orderBy` / `page` DTO your HTTP layer received, which is the improvement. But **`total` is never populated by `list()`**: Sequelize's `count` was a second query it ran for you, and here you run it yourself with `aggregate`. See [Count rows](./guide-count-rows.html). If your UI only needs "is there another page", `hasMore` is free and no count is needed at all.

## Operators

Sequelize's `Op` symbols become plain keys:

```ts
// { [Op.gte]: 18 }  ->
{ age: { gte: 18 } }
// { [Op.in]: [1,2] } ->
{ id: { in: [1, 2] } }
// { [Op.like]: '%a%' } ->
{ name: { like: '%a%' } }
```

There is no `Op.or` at the DTO level yet — the builder has `orWhere`. See [Filters & Operators](./filters.html).

## Associations

`User.hasMany(Post)` becomes a tag on the declaration, and the accessors (`user.getPosts()`, `user.addPost()`) go away:

```ts
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  posts?: Post[] & OneToMany<'posts', 'userId'>;
}

const user = await repo.findById(id, { populate: ['posts'] });
```

`include: [Post]` becomes `populate: ['posts']`. See [Populate & Join Results](./populate-results.html).

## Hooks

`beforeCreate` / `afterCreate` become the repository's protected hooks, which receive the row data rather than a model instance:

```ts
class UserRepository extends BaseRepository<User> {
  protected preInsert(row: Record<string, unknown>) {
    /* ... */
  }
}
```

See [Lifecycle Hooks](./lifecycle-hooks.html).

## Migrations and umzug

Sequelize CLI + umzug becomes the [migration runner](./migrations-cli.html), which is the same idea (ordered, versioned, recorded in a table) with a `MigrationConnection` you implement over your driver.

## Validation

Sequelize's model-level `validate` runs on `save`. zmdb splits this in two: column [validation rules](./schema-declaration.html) feed the JSON Schema and OpenAPI output, and request payloads are checked by a [generated validator](./validators-assert.html) at the HTTP boundary, before anything reaches the repository. Validating at the edge means an invalid request never becomes a partially-applied write.

---

See also: [Repository](./repository.html) · [Read/Query DTOs](./read-dtos.html) · [Filters & Operators](./filters.html)
