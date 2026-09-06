import { grpcDescriptor, loadGrpcService, protoDecode, protoDescriptor, protoEncode } from '@zmdb/protobuf';
import { afterAll, describe, expect, it } from 'vitest';

import { FixtureProject } from '../emit/__testing__/project.js';
import { CALLEES } from '../transform/index.js';
import { zmdbAot } from '../unplugin/index.js';

it('recognises the canonical protobuf callees in the transformer', () => {
  const names = ['grpcDescriptor', 'loadGrpcService', 'protoDecode', 'protoDescriptor', 'protoEncode'] as const;
  expect([...CALLEES]).toEqual(expect.arrayContaining([...names]));

  // A name in CALLEES is not enough: the canonical package must own a callable
  // development-path export for every transformed call.
  const surface: Readonly<Record<string, unknown>> = {
    grpcDescriptor,
    loadGrpcService,
    protoDecode,
    protoDescriptor,
    protoEncode,
  };
  for (const name of names) {
    expect(typeof surface[name], `${name} is in CALLEES but is not exported`).toBe('function');
  }
});

const project = FixtureProject.open();
afterAll(() => project.close());

const MESSAGE = `import type { Proto, ProtoField } from '@zmdb/schema-core/tags';

interface Message {
  readonly value: number & Proto<'int32'> & ProtoField<1>;
}
`;

function transform(source: string, name: string): string | undefined {
  const file = project.write(name, source);
  return zmdbAot({ session: project.session }).transform(source, file)?.code;
}

describe('protobuf call ownership in the plugin', () => {
  it.each([
    ['direct', `import { protoEncode } from '@zmdb/protobuf';\n`, 'protoEncode<Message>'],
    ['aliased', `import { protoEncode as encodeProto } from '@zmdb/protobuf';\n`, 'encodeProto<Message>'],
    ['namespace', `import * as protobuf from '@zmdb/protobuf';\n`, 'protobuf.protoEncode<Message>'],
  ])('transforms a %s canonical import', (kind, imported, call) => {
    const source = `${imported}${MESSAGE}
export const bytes = ${call}({ value: 7 });
`;
    const code = transform(source, `canonical-${kind}.ts`);
    expect(code).toContain('new _zmdbProtoWriter()');
    expect(code).toContain('@zmdb/protobuf/wire');
    expect(code).not.toContain(call);
  });

  it('leaves a same-named foreign export unchanged', () => {
    project.write(
      'foreign-protobuf.ts',
      `export function protoEncode<T>(_value: T): Uint8Array {
  return new Uint8Array();
}
`,
    );
    const source = `import { protoEncode } from './foreign-protobuf.js';

export const bytes = protoEncode<{ readonly value: number }>({ value: 7 });
`;
    expect(transform(source, 'foreign-call.ts')).toBeUndefined();
  });
});
