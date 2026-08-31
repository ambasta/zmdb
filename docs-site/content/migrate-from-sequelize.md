Sequelize models are classes with instance methods and a runtime-declared schema. The zmdb equivalent is a schema object plus a repository, and none of the instance methods survive.

## Model → schema object

```js
// Sequelize
const User = sequelize.define('User', {
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
});
```

```ts
// zmdb
export const users = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().unique(),
  active: boolean().notNull().defaultTo(true),
});
```

Sequelize adds `id`, `createdAt` and `updatedAt` for you. zmdb adds nothing — every column in the table is a column in the schema object, because the schema object is what generates the DDL and the DTOs. Being implicit about columns is how the DTO and the table drift apart.

> [!NOTE]
> If you are migrating an existing Sequelize database, you have to write out the timestamp columns by hand: there is no introspection to read them for you. See [pull](./cli-pull.html).

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

`findAndCountAll` mapping to `list` is a genuine improvement rather than a rename: `list` returns `ListResult<Row>` with `rows` and `total` in one typed envelope, and it takes the same `where` / `orderBy` / `page` DTO your HTTP layer received.

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

`User.hasMany(Post)` becomes a relations map entry, and the accessors (`user.getPosts()`, `user.addPost()`) go away:

```ts
export const userRelations = { posts: oneToMany(posts, 'userId') };
const user = await repo.findById(id, { populate: ['posts'] });
```

`include: [Post]` becomes `populate: ['posts']`. See [Populate & Join Results](./populate-results.html).

## Hooks

`beforeCreate` / `afterCreate` become the repository's protected hooks, which receive the row data rather than a model instance:

```ts
class UserRepository extends BaseRepository<typeof users> {
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
