`zmdb new` creates projects and application components. `zmdb generate` keeps
its separate meaning: generate a migration from the declared schema.

## Start a project

This transcript is from the real package bin:

```text
$ npx zmdb new project blog
created blog/package.json
created blog/tsconfig.json
created blog/scripts/build.mjs
created blog/vitest.config.ts
created blog/zmdb.config.ts
created blog/src/app.module.ts
created blog/src/main.ts
created blog/src/health.controller.ts
created blog/src/health.controller.spec.ts
created blog/.gitignore
```

The generated tree is exactly:

```text
blog/
├── .gitignore
├── package.json
├── scripts/
│   └── build.mjs
├── src/
│   ├── app.module.ts
│   ├── health.controller.spec.ts
│   ├── health.controller.ts
│   └── main.ts
├── tsconfig.json
├── vitest.config.ts
└── zmdb.config.ts
```

It is a runnable SQLite application, not a collection of placeholders. The
config opens a file-backed database, the health test drives the real web test
application and database driver, and the AOT adapter is used for both application
and test builds.

After installing dependencies, the generated scripts exercise the same classes
of gate as this repository:

```bash
cd blog
npm install
npm run check
npm run build
npm start
```

`check` runs formatting, TypeScript, lint, the AOT test build, and Vitest.

## Add application components

The six scaffold kinds are `project`, `schema`, `controller`, `module`,
`repository`, and `command`:

```text
$ npx zmdb new schema post
created src/post.ts
created src/post.spec.ts

$ npx zmdb new controller posts
created src/posts.controller.ts
created src/posts.controller.spec.ts

add to src/app.module.ts, in @Module({ controllers: [ … ] }):
  PostsController,

$ npx zmdb new module billing
created src/billing.module.ts
created src/billing.module.spec.ts

add to src/app.module.ts, in @Module({ imports: [ … ] }):
  BillingModule,

$ npx zmdb new repository post
created src/post.repository.ts
created src/post.repository.spec.ts

add to src/app.module.ts, in @Module({ providers: [ … ] }):
  postRepositoryProvider(driver),

$ npx zmdb new command import-posts
created src/import-posts.command.ts
created src/import-posts.command.spec.ts

add to src/app.module.ts, in @Module({ commands: [ … ] }):
  ImportPostsCommand,
```

Those commands add this measured file set:

```text
src/
├── billing.module.spec.ts
├── billing.module.ts
├── import-posts.command.spec.ts
├── import-posts.command.ts
├── post.repository.spec.ts
├── post.repository.ts
├── post.spec.ts
├── post.ts
├── posts.controller.spec.ts
└── posts.controller.ts
```

Every scaffold that contains behaviour includes a behavioural spec. The schema
spec also contains an AOT canary, so a package that forgot the transformer fails
in its tests instead of accepting unchecked input.

## Safety properties

- Source, JSON, and build files are formatted with the repository's formatter
  before they are written.
- Existing paths are never replaced. `--force` is a database-operation flag and
  does not override scaffold conflicts.
- `--dry-run` prints every complete formatted file and writes nothing.
- A scaffold never edits a barrel or an existing application module. It prints
  the exact registration entry instead.
- Invalid TypeScript names and ambiguous workspace targets are usage errors.
  See [Monorepos & Libraries](./web-cli-monorepo.html).

These are structural rules in the implementation and acceptance tests, not
recommendations for template authors.

## Why the generated source stays small

A controller remains ordinary framework code:

```ts
@Controller('/posts')
export class PostsController {
  @Get()
  list(): { readonly resource: string; readonly items: readonly unknown[] } {
    return { resource: 'posts', items: [] };
  }
}
```

The useful generated material is the route test and the explicit module wiring,
not a second abstraction over controllers. A schema is still one interface;
DTOs, JSON Schema, DDL, and validators derive from it rather than becoming more
generated files.

## The rest of the executable

The same bin also owns migrations, checks, catalog pull, DDL export, module
inspection, the REPL, and the read-only Studio:

```bash
npx zmdb --help
npx zmdb generate --name add_posts
npx zmdb migrate
npx zmdb check
npx zmdb studio
```

See the [CLI overview](./cli-overview.html) for the complete command and exit-code
reference.

---

See also: [Monorepos & Libraries](./web-cli-monorepo.html) · [Building CLI
Applications](./web-cli-apps.html) · [studio](./cli-studio.html)
