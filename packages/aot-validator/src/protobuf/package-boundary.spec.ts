import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FixtureProject } from '../emit/__testing__/project.js';
import { apiInstanceCount } from '../reflect/session.js';

const ROOT = new URL('../../../../', import.meta.url).pathname;

const COMPILER_DECLARATIONS = String.raw`
  const zmdbProtoField: unique symbol;
  const zmdbProtoScalar: unique symbol;

  type ProtoField<N extends number> = { readonly [zmdbProtoField]?: N };
  type Proto<K extends string> = { readonly [zmdbProtoScalar]?: K };

  function protoEncode<T>(value: T): Uint8Array;

  interface GrpcMethodDef {
    readonly request: unknown;
    readonly response: unknown;
    readonly requestStream?: true;
    readonly responseStream?: true;
  }
  type GrpcServiceDef = { readonly [method: string]: GrpcMethodDef };
  function loadGrpcService<S extends GrpcServiceDef>(service: string, pkg: string): unknown;

  interface GetOrder {
    id: string & ProtoField<1>;
  }
  interface Order {
    id: string & ProtoField<1>;
    total: number & Proto<'int32'> & ProtoField<2>;
  }
  type Orders = {
    readonly get: { request: GetOrder; response: Order };
  };
`;

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'dist' || entry.name === 'node_modules') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function generated(suffix: string): readonly { readonly path: string; readonly source: string }[] {
  return [join(ROOT, 'packages'), join(ROOT, 'fixtures')]
    .flatMap(filesUnder)
    .filter(path => path.endsWith(suffix))
    .map(path => ({ path, source: readFileSync(path, 'utf8') }));
}

function importsNaming(source: string, names: readonly string[]): string[] {
  const modules = [];
  for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    const bindings = match[1] ?? '';
    if (names.some(name => new RegExp(`\\b${name}\\b`).test(bindings))) modules.push(match[2] ?? '');
  }
  return [...new Set(modules)].toSorted();
}

describe('protobuf package provenance (#655)', () => {
  it.fails('generated protobuf codecs import only @zmdb/protobuf/wire', () => {
    const codecs = generated('.zmdb.generated.js').filter(({ source }) => /Proto(?:Reader|Writer)/.test(source));
    expect(codecs.length).toBeGreaterThan(0);
    for (const codec of codecs) {
      expect(importsNaming(codec.source, ['ProtoReader', 'ProtoWriter']), codec.path).toEqual(['@zmdb/protobuf/wire']);
      expect(codec.source, codec.path).not.toContain('@zmdb/aot-validator/protobuf/wire');
    }
  });

  it.fails('generated gRPC artifacts import their public types only from @zmdb/protobuf', () => {
    const artifacts = [...generated('.zmdb.generated.d.ts'), ...generated('.zmdb.witness.ts')].filter(({ source }) =>
      /GrpcLoadedService|loadGrpcService/.test(source),
    );
    expect(artifacts.length).toBeGreaterThan(0);
    for (const artifact of artifacts) {
      expect(importsNaming(artifact.source, ['GrpcLoadedService', 'loadGrpcService']), artifact.path).toEqual([
        '@zmdb/protobuf',
      ]);
      expect(artifact.source, artifact.path).not.toContain("from '@zmdb/aot-validator'");
    }
  });

  it('protobuf and gRPC generation open no second reflection session', () => {
    const before = apiInstanceCount();
    using project = FixtureProject.open({ declarations: COMPILER_DECLARATIONS });
    const result = project.transform(`
      const encoded = protoEncode<GetOrder>({ id: 'o1' });
      const service = loadGrpcService<Orders>('Orders', 'orders');
      const check = () => ({ encoded, service });
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.code).toContain('ProtoWriter');
    expect(result.code).toContain('orders.Orders');
    expect(apiInstanceCount() - before).toBe(1);
  });
});
