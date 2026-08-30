// Generates re-export declaration files (.d.ts) for built dist artifacts.
import { writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);

const MAPPINGS = {
  'schema-core': {
    index: '../src/index.ts',
    dto: '../src/dto/index.ts',
    'custom-types': '../src/custom-types/index.ts',
    seeding: '../src/seeding/index.ts',
    llm: '../src/llm/index.ts',
  },
  'query-compiler': {
    index: '../src/index.ts',
    fts: '../src/fts/index.ts',
    joins: '../src/joins/index.ts',
    aggregations: '../src/aggregations/index.ts',
    migrations: '../src/migrations/index.ts',
    'set-ops': '../src/set-ops/index.ts',
    'schema-objects': '../src/schema-objects/index.ts',
  },
  'aot-validator': {
    index: '../src/index.ts',
    advanced: '../src/advanced/index.ts',
    serialization: '../src/serialization/index.ts',
    utilities: '../src/utilities/index.ts',
    plugin: '../src/plugin/index.ts',
  },
  repository: {
    index: '../src/index.ts',
    transactions: '../src/transactions/index.ts',
    replicas: '../src/replicas/index.ts',
    integrations: '../src/integrations/index.ts',
    'entity-modeling': '../src/entity-modeling/index.ts',
    'drivers-sqlite': '../src/drivers/sqlite.ts',
    'drivers-pg': '../src/drivers/pg.ts',
  },
  web: {
    index: '../src/index.ts',
    routing: '../src/routing/index.ts',
    context: '../src/context/index.ts',
    di: '../src/di/index.ts',
    state: '../src/state/index.ts',
    pipeline: '../src/pipeline/index.ts',
    data: '../src/data/index.ts',
    modules: '../src/modules/index.ts',
    middleware: '../src/middleware/index.ts',
    app: '../src/app/index.ts',
    'dto-pipes': '../src/dto-pipes/index.ts',
    openapi: '../src/openapi/index.ts',
    gateways: '../src/gateways/index.ts',
    testing: '../src/testing/index.ts',
    bench: '../src/bench/index.ts',
  },
  zmdb: {
    index: '../src/index.ts',
    dto: '../src/dto.ts',
    relations: '../src/relations.ts',
    'drivers-sqlite': '../src/drivers-sqlite.ts',
    'drivers-pg': '../src/drivers-pg.ts',
    web: '../src/web.ts',
  },
};

for (const [pkg, entries] of Object.entries(MAPPINGS)) {
  const distDir = join(ROOT, 'packages', pkg, 'dist');
  if (!existsSync(distDir)) continue;
  for (const [base, srcPath] of Object.entries(entries)) {
    const dtsPath = join(distDir, `${base}.d.ts`);
    writeFileSync(dtsPath, `export * from '${srcPath}';\n`);
  }
}
