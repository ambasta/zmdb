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
// The upstream contract requires exact/plain bodies (a bare id, truly empty
// responses) rather than JSON envelopes, so responses are written directly via
// node:http here in the harness. The framework's route table + param extraction
// are what is exercised — identical to what @zmdb/web's own dispatcher resolves.

import { createServer } from 'node:http';
import {
  Controller,
  Get,
  Post,
  getRoutes,
  extractParams,
  type Ctx,
} from '../../../packages/web/dist/index.js';

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

@Controller()
class BenchmarkController {
  @Get('/')
  root(): void {}

  @Get('/user/:id')
  getUser(ctx: Ctx<{ id: string }>): string {
    return ctx.params.id;
  }

  @Post('/user')
  createUser(): void {}
}

const controller = new BenchmarkController();
const routes = getRoutes(BenchmarkController);
const PORT = Number(process.env.PORT ?? 3000);

const server = createServer((req, res) => {
  const method = (req.method ?? 'GET').toUpperCase();
  const path = (req.url ?? '/').split('?')[0] ?? '/';

  for (const route of routes) {
    if (route.method !== method) continue;
    const params = extractParams(route.path, path);
    if (params === undefined) continue;

    req.resume(); // drain any request body (empty in the contract)
    if (route.handlerName === 'getUser') {
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
    } else {
      res.writeHead(200);
      res.end();
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.info(`@zmdb/web benchmark app on :${PORT} (${routes.length} routes)`);
});
