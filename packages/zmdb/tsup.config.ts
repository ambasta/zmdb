import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    dto: 'src/dto.ts',
    relations: 'src/relations.ts',
    'drivers-sqlite': 'src/drivers-sqlite.ts',
    'drivers-pg': 'src/drivers-pg.ts',
    web: 'src/web.ts',
  },
  format: ['esm'],
  dts: false,
  clean: true,
  target: 'node22',
  external: [/^@zmdb\//],
});
