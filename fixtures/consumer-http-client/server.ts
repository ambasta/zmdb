import { createServer } from 'node:http';
import { join } from 'node:path';

import { ReflectSession } from '@zmdb/compiler/reflect';
import { createRouter, toNodeHandler, type Guard } from '@zmdb/web';
import { compileHttpContracts } from '@zmdb/web/contract/compiler';

import { FIXTURE_TOKEN, FixtureController, HTTP_CONTRACT } from './contract.js';

const root = process.env.ZMDB_HTTP_FIXTURE_ROOT;
if (root === undefined) throw new Error('ZMDB_HTTP_FIXTURE_ROOT is required');

const project = join(root, 'tsconfig.generate.json');
const contractFile = join(root, 'contract.ts');
const session = ReflectSession.open({ project });
const compiled = compileHttpContracts([{ file: contractFile, exportName: 'HTTP_CONTRACT', contract: HTTP_CONTRACT }], {
  session,
});
session.close();

const operation = compiled.ir.operations.find(candidate => candidate.operationId === 'get_fixture_account');
if (operation === undefined) throw new Error('the fixture contract omitted get_fixture_account');

const bearerGuard: Guard = {
  canActivate: ctx => ctx.headers.authorization === `Bearer ${FIXTURE_TOKEN}`,
};
const router = createRouter();
router.registerContract(compiled, [new FixtureController()], {
  FixtureController: {
    getAccount: {
      guards: [bearerGuard],
      security: operation.security,
    },
  },
});

const handle = toNodeHandler(router);
const server = createServer((request, response) => {
  handle(
    {
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      headers: request.headers,
      on: (event, listener) => {
        request.on(event, listener);
      },
      setEncoding: encoding => {
        if (encoding !== 'utf8') throw new Error(`unexpected request encoding ${encoding}`);
        request.setEncoding('utf8');
      },
    },
    response,
  );
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('the HTTP client fixture received no TCP address');
  }
  process.stdout.write(`http://127.0.0.1:${String(address.port)}\n`);
});

const stop = (): void => {
  server.close(error => {
    if (error !== undefined) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  });
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
