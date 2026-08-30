// @zmdb/web — the-benchmarker/web-frameworks contract app.
//
// Strictly implements the shared HTTP contract
// (https://github.com/the-benchmarker/web-frameworks):
//   GET  /          → 2xx, empty body
//   GET  /user/:id  → 2xx, body is the raw `id` path parameter
//   POST /user      → 2xx, empty body
//
// Listens on port 3000 (override with PORT). Built on @zmdb/web's REAL routing:
// Stage-3 @Controller/@Get/@Post decorators, getRoutes (route table resolved
// once at boot — no per-request reflection), and extractParams. It imports the
// COMPILED package (../../../packages/web/dist) so the Stage-3 decorators are
// lowered by the package build; run `node app.js` after `tsup` (see run.sh).
//
// ONE DEFINITION TO RULE THEM ALL: the `User` shape below is declared exactly
// once via @zmdb/schema-core's `defineSchema`. The request body type
// (`CreateDTO<typeof UserSchema>`), the OpenAPI-ready structure, and the POST
// /user validator are ALL derived from that single definition — no second,
// hand-maintained copy of the shape.
//
// AOT VALIDATION: from that single schema we derive a `TypeDescriptor` and, at
// BOOT (ahead of the request hot path), compile it into a monomorphic,
// straight-line validator closure via @zmdb/aot-validator's `assert`. The
// per-request path only calls the pre-compiled closure — the AOT premise
// (compile-once, run-many) applied to the web layer. `@zmdb/web`'s
// `validateWith` wraps that closure into the framework's `validateBody` hook.
//
// The upstream contract requires exact/plain bodies (a bare id, truly empty
// responses) rather than JSON envelopes, so responses are written directly via
// node:http here in the harness. The framework's route table + param extraction
// are what is exercised — identical to what @zmdb/web's own dispatcher resolves.

import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { Controller, Get, Post, getRoutes, extractParams, validateWith, type Ctx } from '../../../packages/web/dist/index.js';
import { defineSchema, serial, text } from '../../../packages/schema-core/src/index.ts';
import type { CoreSchema, ColumnMeta, CreateDTO } from '../../../packages/schema-core/src/index.ts';
import { assert, type TypeDescriptor } from '../../../packages/aot-validator/src/utilities/index.ts';

// Ensure the well-known Symbol.metadata exists before the decorated class is
// evaluated. @zmdb/web ships this polyfill, but the package is `sideEffects:
// false`, so a bundler may tree-shake the side-effect import — we install it
// explicitly here (a no-op once a runtime ships Symbol.metadata natively).
interface SymbolWithMetadata {
  metadata?: symbol;
}
const symbolCarrier: SymbolWithMetadata = Symbol;
if (symbolCarrier.metadata === undefined) {
  Object.defineProperty(Symbol, 'metadata', {
    value: Symbol.for('Symbol.metadata'),
    configurable: true,
  });
}

// --- ONE DEFINITION ---------------------------------------------------------
// The single source of truth for the User shape. Types, validation, and (if
// wired) persistence all derive from this.
const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  name: text().notNull(),
  email: text().notNull(),
});
type UserCreate = CreateDTO<typeof UserSchema>;

// --- schema → AOT descriptor ------------------------------------------------
// Map a schema-core `SqlType` to a runtime TypeDescriptor kind. Derived from
// the ONE definition, so the validator can never drift from the schema.
function columnKind(col: ColumnMeta): TypeDescriptor {
  switch (col.type) {
    case 'serial':
    case 'integer':
    case 'numeric':
    case 'bigint':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'jsonEnum':
      return { kind: 'enum', values: col.flags.enum ?? [] };
    default:
      return col.flags.length === undefined ? { kind: 'string' } : { kind: 'string', maxLength: col.flags.length };
  }
}

// Build the CreateDTO descriptor: drop auto-increment columns (server-assigned)
// exactly as `CreateDTO<S>` drops them at the type level.
function createDtoDescriptor(schema: CoreSchema<string>): TypeDescriptor {
  const fields: Record<string, TypeDescriptor> = {};
  for (const [name, col] of Object.entries(schema.columns)) {
    if (col.flags.autoIncrement === true) continue;
    fields[name] = columnKind(col);
  }
  return { kind: 'object', fields };
}

// --- AOT compile at BOOT ----------------------------------------------------
// Compile the descriptor into a closure ONCE, ahead of the request hot path.
// `validateWith` adapts it into @zmdb/web's validateBody hook shape.
const userCreateDescriptor = createDtoDescriptor(UserSchema);
const validateUserCreate = validateWith<UserCreate>((raw: unknown) => assert<UserCreate>(raw, userCreateDescriptor));

@Controller()
class BenchmarkController {
  @Get('/')
  root(): void {}

  @Get('/user/:id')
  getUser(ctx: Ctx<{ id: string }>): string {
    return ctx.params.id;
  }

  @Post('/user')
  createUser(ctx: Ctx<Record<never, string>, UserCreate | undefined>): void {
    // Contract POST body is empty; when a body IS supplied, validate it on the
    // hot path via the boot-compiled AOT validator (derived from UserSchema).
    if (ctx.body !== undefined) validateUserCreate(ctx.body);
  }
}

const controller = new BenchmarkController();
const routes = getRoutes(BenchmarkController);
const PORT = Number(process.env.PORT ?? 3000);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

const server = createServer((req, res) => {
  const method = (req.method ?? 'GET').toUpperCase();
  const path = (req.url ?? '/').split('?')[0] ?? '/';

  for (const route of routes) {
    if (route.method !== method) continue;
    const params = extractParams(route.path, path);
    if (params === undefined) continue;

    if (route.handlerName === 'getUser') {
      req.resume(); // drain any request body (empty in the contract)
      const id = controller.getUser({
        params: { id: params.id ?? '' },
        body: undefined,
        query: {},
        headers: {},
        method,
        path,
      });
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(id);
    } else if (route.handlerName === 'createUser') {
      // Read the (contract-empty) body; only parse+validate when non-empty so
      // the AOT validator runs on the hot path for real payloads.
      void readBody(req).then(raw => {
        let body: UserCreate | undefined;
        if (raw.length > 0) {
          try {
            body = JSON.parse(raw) as UserCreate;
          } catch {
            res.writeHead(400);
            res.end();
            return;
          }
        }
        try {
          controller.createUser({ params: {}, body, query: {}, headers: {}, method, path });
        } catch {
          res.writeHead(422);
          res.end();
          return;
        }
        res.writeHead(200);
        res.end();
      });
    } else {
      req.resume();
      res.writeHead(200);
      res.end();
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.info(`@zmdb/web benchmark app on :${PORT} (${routes.length} routes, AOT-validated POST /user from one schema)`);
});
