// What `zmdb-codegen` does to the source file it rewrites.
//
// The consumer fixtures next door prove the whole route works, but they prove it on a file that
// has *already* been rewritten — so the interesting half never runs there. Deleting an import
// that just became dead, keeping one that did not, and leaving the file's own formatting alone
// only happen the first time, and each of the three was a bug during development:
//
//  - `import { is } from '…'` survived, because a comment in the file said the word "is" and
//    the check for whether the name was still used was a text search.
//  - The deleted import left a blank line behind, and when it was the first line, the file
//    began with one.
//  - The formatter wrapped the generated import across eight lines, and the next `--check`
//    called that stale — a loop between two tools that both thought they were right.
//
// So this drives `codegen()` over a throwaway project per case and reads the source back. It is
// a compiler session per test, which is the price of the rewrite being a function of what the
// checker knows rather than of the text.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { apiInstanceCount, ReflectSession } from '../reflect/session.js';
import { codegen, watchCodegen, type CodegenResult } from './index.js';

/** The repo root, so a temp project outside it can still resolve `@zmdb/*`. */
const ROOT = new URL('../../../../', import.meta.url).pathname;

const TSCONFIG = {
  compilerOptions: {
    target: 'ESNext',
    lib: ['ESNext'],
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    noEmit: true,
    // No `node_modules` here and nothing touching a Node builtin.
    types: [] as string[],
    paths: {
      '@zmdb/schema-core': [`${ROOT}packages/schema-core/src/index.ts`],
      '@zmdb/schema-core/*': [`${ROOT}packages/schema-core/src/*/index.ts`],
      '@zmdb/aot-validator': [`${ROOT}packages/aot-validator/src/index.ts`],
      '@zmdb/aot-validator/*': [`${ROOT}packages/aot-validator/src/*/index.ts`],
      '@zmdb/protobuf': [`${ROOT}packages/protobuf/src/index.ts`],
      '@zmdb/protobuf/*': [`${ROOT}packages/protobuf/src/*.ts`],
      '@consumer/validation': [`${ROOT}packages/aot-validator/src/utilities/index.ts`],
    },
  },
  include: ['**/*.ts'],
};

const MODEL = `export interface Order {
  readonly id: number;
  readonly reference: string;
}
`;

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

interface Run {
  /** The project's `src/`, for the tests that edit a file behind the generator's back. */
  readonly src: string;
  /** The rewritten `app.ts`. */
  readonly app: string;
  readonly result: CodegenResult;
  /** Run the generator again over whatever is on disk now. */
  readonly again: (check?: boolean) => Run;
}

/**
 * A one-module project on disk, and nothing done to it yet.
 *
 * A fresh directory per call rather than a shared one: `codegen` opens its own session anyway,
 * so a shared directory would buy nothing and would let one case's leftover artifacts decide
 * another case's answer.
 */
function project(app: string, extra: Readonly<Record<string, string>> = {}): { src: string; tsconfig: string } {
  const directory = mkdtempSync(join(tmpdir(), 'zmdb-rewrite-'));
  directories.push(directory);
  mkdirSync(join(directory, 'src'), { recursive: true });
  // `"type": "module"`, or `moduleResolution: NodeNext` reads every `.ts` here as CommonJS and
  // the generated witness — which is ESM, because the source it mirrors is — does not compile.
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(TSCONFIG, null, 2));
  writeFileSync(join(directory, 'src', 'model.ts'), MODEL);
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(directory, 'src', name), text);
  writeFileSync(join(directory, 'src', 'app.ts'), app);
  return { src: join(directory, 'src'), tsconfig: join(directory, 'tsconfig.json') };
}

/** Write a one-module project, generate for it, and read the result back. */
function generate(app: string, extra: Readonly<Record<string, string>> = {}): Run {
  const { src, tsconfig } = project(app, extra);
  const once = (check: boolean): Run => {
    const result = codegen({ project: tsconfig, ...(check ? { check: true } : {}) });
    return {
      src,
      app: readFileSync(join(src, 'app.ts'), 'utf8'),
      result,
      again: (nextCheck = false) => once(nextCheck),
    };
  };
  return once(false);
}

const ok = (result: CodegenResult): void => {
  expect(result.problems).toEqual([]);
  expect(result.ok).toBe(true);
};

// -----------------------------------------------------------------------------
// The import that is now dead
// -----------------------------------------------------------------------------

describe('an import the rewrite compiled away', () => {
  it('goes, and takes its line with it', () => {
    const run = generate(`import { is } from '@zmdb/aot-validator/utilities';

import type { Order } from './model.js';

export const accepts = (value: unknown): boolean => is<Order>(value);
`);
    ok(run.result);
    expect(run.app).not.toContain("from '@zmdb/aot-validator'");
    expect(run.app).toContain("from './app.zmdb.generated.js'");
    // No blank line where the statement was, and none at the top of the file — a deleted first
    // import used to leave the file beginning with the paragraph break that followed it.
    expect(run.app.startsWith('\n')).toBe(false);
    expect(run.app).not.toContain('\n\n\n');
  });

  it('goes even when a comment says its name', () => {
    // The regression that started this file. `is` appears in the prose, and a text search for
    // it kept an import of a function nothing calls any more — which then failed to typecheck,
    // because the generated module exports `zmdbIsOrder`, not `is`.
    const run = generate(`import { is } from '@zmdb/aot-validator/utilities';

import type { Order } from './model.js';

// Six derivations of one interface: the type argument *is* the input, and nothing
// declares a schema. \`is\` is the one this file needs.
export const accepts = (value: unknown): boolean => is<Order>(value);
`);
    ok(run.result);
    expect(run.app).not.toContain("from '@zmdb/aot-validator'");
    expect(run.app).toContain('the type argument *is* the input');
  });

  it('keeps the names the file still uses', () => {
    // Half the import is compiled away and half is not, which is the case that makes this a
    // rewrite of the clause rather than a deletion of the statement.
    const run = generate(`import { is, type ValidateResult, validate } from '@zmdb/aot-validator/utilities';

import type { Order } from './model.js';

export const accepts = (value: unknown): boolean => is<Order>(value);
export const explain = (value: unknown): ValidateResult<Order> => validate<Order>(value);
`);
    ok(run.result);
    expect(run.app).toContain("import { type ValidateResult } from '@zmdb/aot-validator/utilities';");
    expect(run.app).not.toMatch(/import \{[^}]*\bis\b[^}]*\} from '@zmdb\/aot-validator\/utilities'/);
  });

  it('is replaced in place when it was the only import in the file', () => {
    // An inline type argument needs nothing from `./model.ts`, so the validator import is the
    // whole import block, and deleting it leaves nowhere to anchor the new one.
    const run = generate(`import { is } from '@zmdb/aot-validator/utilities';

export const acceptsPoint = (value: unknown): boolean => is<{ readonly x: number }>(value);
`);
    ok(run.result);
    expect(run.app).not.toContain('@zmdb/aot-validator');
    expect(run.app).toContain("from './app.zmdb.generated.js'");
    expect(run.app.startsWith('import ')).toBe(true);
    expect(run.app).not.toContain('\n\n\n');
    // And it is still a file a formatter would leave alone: one blank line between the import
    // block and the code, which is the whitespace the deleted statement was holding.
    expect(run.app).toMatch(/;\n\nexport const acceptsPoint/);
  });

  it('survives a namespace import, which is used by whatever it is used for', () => {
    // `zmdb.is<Order>(v)` is a call site — `calleeName` reads through the property access — but
    // `zmdb` itself may still be used for anything else in the file, and a namespace binding is
    // not divisible. So it stays.
    const run = generate(`import * as zmdb from '@zmdb/aot-validator/utilities';

import type { Order } from './model.js';

export const accepts = (value: unknown): boolean => zmdb.is<Order>(value);
export const failed = (error: unknown): boolean => error instanceof zmdb.AssertError;
`);
    ok(run.result);
    expect(run.app).toContain("import * as zmdb from '@zmdb/aot-validator/utilities';");
    expect(run.app).toContain('zmdbIsOrder(value)');
  });
});

// -----------------------------------------------------------------------------
// Running twice
// -----------------------------------------------------------------------------

describe('a second run', () => {
  it('changes nothing, and --check agrees', () => {
    // Idempotence is what makes this safe to put in a pre-commit hook. It is also what the
    // committed fixture depends on: `--check` recomputes the whole rewrite and compares.
    const first = generate(`import { is } from '@zmdb/aot-validator/utilities';

import type { Order } from './model.js';

export const accepts = (value: unknown): boolean => is<Order>(value);
`);
    ok(first.result);
    const second = first.again();
    ok(second.result);
    expect(second.result.written).toEqual([]);
    expect(second.app).toBe(first.app);

    const checked = second.again(true);
    ok(checked.result);
    expect(checked.result.written).toEqual([]);
  });

  it('accepts a generated import a formatter has rewrapped and reordered', () => {
    // The other loop. oxfmt wraps a 200-character import across eight lines and sorts the
    // clause; if `--check` compared import *text* it would call that stale, rewrite it, and be
    // told off by `fmt --check` on the next run, forever. It compares the imported *names*.
    const run = generate(`import { assert, is, validate } from '@zmdb/aot-validator/utilities';

import type { Order } from './model.js';

export const accepts = (value: unknown): boolean => is<Order>(value);
export const insist = (value: unknown): Order => assert<Order>(value);
export const explain = (value: unknown) => validate<Order>(value);
`);
    ok(run.result);
    const wrapped = run.app.replace(
      /import \{[^}]*\} from '\.\/app\.zmdb\.generated\.js';/,
      `import {\n  zmdbValidateOrder,\n  zmdbAssertOrder,\n  zmdbIsOrder,\n} from './app.zmdb.generated.js';`,
    );
    expect(wrapped).not.toBe(run.app);
    writeFileSync(join(run.src, 'app.ts'), wrapped);

    const checked = run.again(true);
    ok(checked.result);
    expect(checked.result.written).toEqual([]);
    expect(checked.app).toBe(wrapped);
  });
});

// -----------------------------------------------------------------------------
// Protobuf calls
// -----------------------------------------------------------------------------

describe('a protobuf encoder call', () => {
  it('writes a checked Uint8Array wrapper and preserves the wire-runtime import', () => {
    const run = generate(`import { protoEncode } from '@zmdb/protobuf';
import type { Proto, ProtoField } from '@zmdb/schema-core/tags';

export interface Message {
  value: number & Proto<'int32'> & ProtoField<1>;
}

export const encodeMessage = (value: Message): Uint8Array => protoEncode<Message>(value);
`);
    ok(run.result);
    expect(run.app).toContain('zmdbProtoEncodeMessage(value)');
    expect(run.app).not.toContain('protoEncode<Message>');

    const generated = readFileSync(join(run.src, 'app.zmdb.generated.js'), 'utf8');
    const declaration = readFileSync(join(run.src, 'app.zmdb.generated.d.ts'), 'utf8');
    expect(generated).toContain('ProtoWriter');
    expect(generated).toContain('@zmdb/protobuf/wire');
    expect(generated).toContain('export function zmdbProtoEncodeMessage(value)');
    expect(declaration).toContain('export declare function zmdbProtoEncodeMessage(value: Message): Uint8Array;');
  });

  it('recognises an aliased canonical binding and removes only its local name', () => {
    const run = generate(`import { protoEncode as encodeProto } from '@zmdb/protobuf';
import type { Proto, ProtoField } from '@zmdb/schema-core/tags';

export interface Message {
  value: number & Proto<'int32'> & ProtoField<1>;
}

export const encodeMessage = (value: Message): Uint8Array => encodeProto<Message>(value);
`);
    ok(run.result);
    expect(run.app).toContain('zmdbProtoEncodeMessage(value)');
    expect(run.app).not.toContain('encodeProto<Message>');
    expect(run.app).not.toContain("from '@zmdb/protobuf'");
  });

  it('recognises the canonical namespace property', () => {
    const run = generate(`import * as protobuf from '@zmdb/protobuf';
import type { Proto, ProtoField } from '@zmdb/schema-core/tags';

export interface Message {
  value: number & Proto<'int32'> & ProtoField<1>;
}

export const encodeMessage = (value: Message): Uint8Array => protobuf.protoEncode<Message>(value);
`);
    ok(run.result);
    expect(run.app).toContain('zmdbProtoEncodeMessage(value)');
    expect(run.app).not.toContain('protobuf.protoEncode<Message>');
    expect(run.app).not.toContain("from '@zmdb/protobuf'");
  });
});

describe('a protobuf decoder call', () => {
  it('writes a checked message wrapper and preserves the bounded wire-runtime import', () => {
    const run = generate(`import { protoDecode } from '@zmdb/protobuf';
import type { Proto, ProtoField } from '@zmdb/schema-core/tags';

export interface Message {
  value: number & Proto<'int32'> & ProtoField<1>;
}

export const decodeMessage = (bytes: Uint8Array): Message => protoDecode<Message>(bytes);
`);
    ok(run.result);
    expect(run.app).toContain('zmdbProtoDecodeMessage(bytes)');
    expect(run.app).not.toContain('protoDecode<Message>');

    const generated = readFileSync(join(run.src, 'app.zmdb.generated.js'), 'utf8');
    const declaration = readFileSync(join(run.src, 'app.zmdb.generated.d.ts'), 'utf8');
    expect(generated).toContain('ProtoReader');
    expect(generated).toContain('@zmdb/protobuf/wire');
    expect(generated).toContain('export function zmdbProtoDecodeMessage(bytes)');
    expect(declaration).toContain('export declare function zmdbProtoDecodeMessage(bytes: Uint8Array): Message;');
  });
});

describe('a gRPC service loader call', () => {
  it('captures the service and package literals in a zero-argument generated wrapper', () => {
    const run = generate(`import { loadGrpcService } from '@zmdb/protobuf';
import type { ProtoField } from '@zmdb/schema-core/tags';

export interface Ping {
  value: string & ProtoField<1>;
}

export type Echo = {
  readonly ping: { readonly request: Ping; readonly response: Ping };
};

export const echo = loadGrpcService<Echo>('Echo', 'demo');
`);
    ok(run.result);
    expect(run.app).toContain('zmdbLoadGrpcServiceEchoEchoDemo()');
    expect(run.app).not.toContain('loadGrpcService<Echo>');

    const witness = readFileSync(join(run.src, 'app.zmdb.witness.ts'), 'utf8');
    const generated = readFileSync(join(run.src, 'app.zmdb.generated.js'), 'utf8');
    const declaration = readFileSync(join(run.src, 'app.zmdb.generated.d.ts'), 'utf8');
    expect(witness).toContain("return loadGrpcService<Echo>('Echo', 'demo');");
    expect(generated).toContain('service Echo');
    expect(generated).toContain('/demo.Echo/ping');
    expect(declaration).toContain(
      'export declare function zmdbLoadGrpcServiceEchoEchoDemo(): GrpcLoadedService<Echo>;',
    );
  });
});

describe('non-canonical protobuf calls', () => {
  it('an unrelated local protoEncode function is not transformed', () => {
    const source = `function protoEncode<T>(value: T): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

export const bytes = protoEncode<{ readonly id: number }>({ id: 1 });
`;
    const run = generate(source);
    ok(run.result);
    expect(run.app).toBe(source);
    expect(run.result.written).toEqual([]);
  });

  it('leaves a same-named foreign export byte-identical', () => {
    const source = `import { protoEncode } from './foreign.js';

export const bytes = protoEncode<{ readonly id: number }>({ id: 1 });
`;
    const run = generate(source, {
      'foreign.ts': `export function protoEncode<T>(_value: T): Uint8Array {
  return new Uint8Array();
}
`,
    });
    ok(run.result);
    expect(run.app).toBe(source);
    expect(run.result.written).toEqual([]);
  });
});

describe('shallow validator calls', () => {
  it('keeps distinct depths distinct and generates every public shallow form', () => {
    const run = generate(`import {
  assertShallow,
  isShallow,
  validateShallow,
} from '@consumer/validation';

import type { Order } from './model.js';

export const acceptsTop = (value: unknown): boolean => isShallow<Order>(value);
export const acceptsOne = (value: unknown): boolean => isShallow<Order, 1>(value);
export const acceptsTwo = (value: unknown): boolean => isShallow<Order, 2>(value);
export const insistsTwo = (value: unknown): Order => assertShallow<Order, 2>(value);
export const explainsTwo = (value: unknown) => validateShallow<Order, 2>(value);
`);
    ok(run.result);
    expect(run.app).toContain('zmdbIsShallowOrder(value)');
    expect(run.app).toContain('zmdbIsShallowOrderDepth2(value)');
    expect(run.app).toContain('zmdbAssertShallowOrderDepth2(value)');
    expect(run.app).toContain('zmdbValidateShallowOrderDepth2(value)');
    expect(run.app).not.toContain('isShallow<Order');
    expect(run.app.match(/zmdbIsShallowOrder\(value\)/g)).toHaveLength(2);

    const generated = readFileSync(join(run.src, 'app.zmdb.generated.js'), 'utf8');
    const declaration = readFileSync(join(run.src, 'app.zmdb.generated.d.ts'), 'utf8');
    expect(generated).not.toMatch(/\bisShallow\b|\bassertShallow\b|\bvalidateShallow\b/);
    expect(generated).toContain('import { AssertError as _zmdbAssertError } from "@consumer/validation";');
    expect(declaration).toContain('export declare function zmdbIsShallowOrder(value: unknown): value is Order;');
    expect(declaration.match(/declare function zmdbIsShallowOrder\(/g)).toHaveLength(1);
    expect(declaration).toContain('export declare function zmdbIsShallowOrderDepth2(value: unknown): value is Order;');
    expect(declaration).toContain('export declare function zmdbAssertShallowOrderDepth2(value: unknown): Order;');
    expect(declaration).toContain(
      'export declare function zmdbValidateShallowOrderDepth2(value: unknown): ValidateResult<Order>;',
    );
  });
});

// -----------------------------------------------------------------------------
// Whose file it is
// -----------------------------------------------------------------------------

describe('the generated import is written in the style of the file it joins', () => {
  it('uses double quotes in a file that does', () => {
    // The generator writes into somebody else's source, so it is a guest. Emitting the quote
    // character the file already uses is what keeps the edit from showing up as a diff in a
    // project whose formatter disagrees with ours.
    const run = generate(`import { is } from "@zmdb/aot-validator/utilities";

import type { Order } from "./model.js";

export const accepts = (value: unknown): boolean => is<Order>(value);
`);
    ok(run.result);
    expect(run.app).toContain('from "./app.zmdb.generated.js";');
    expect(run.app).not.toContain("from './app.zmdb.generated.js';");
  });

  it('puts the import with the other imports, not at the top of the file', () => {
    // Also the case where the import being deleted is the *last* one, which used to be a bug:
    // the new statement went in after the last import, and when that was the one going away the
    // deletion swallowed it — leaving a file that called `zmdbIsOrder` and imported nothing.
    const run = generate(`// A header comment, which is not an import and must stay where it is.

import type { Order } from './model.js';

import { is } from '@zmdb/aot-validator/utilities';

export const accepts = (value: unknown): boolean => is<Order>(value);
`);
    ok(run.result);
    expect(run.app.startsWith('// A header comment')).toBe(true);
    const lines = run.app.split('\n');
    const generatedAt = lines.findIndex(line => line.includes('app.zmdb.generated.js'));
    const modelAt = lines.findIndex(line => line.includes('./model.ts'));
    expect(generatedAt).toBeGreaterThan(modelAt);
    expect(generatedAt).toBeLessThan(lines.findIndex(line => line.startsWith('export const')));
  });
});

// -----------------------------------------------------------------------------
// When there is nothing left to generate
// -----------------------------------------------------------------------------

describe('a file that stops validating anything', () => {
  it('has its generated modules deleted, not left behind', () => {
    const first = generate(`import { is } from '@zmdb/aot-validator/utilities';

import type { Order } from './model.js';

export const accepts = (value: unknown): boolean => is<Order>(value);
`);
    ok(first.result);
    writeFileSync(join(first.src, 'app.ts'), 'export const accepts = (): boolean => true;\n');

    const second = first.again();
    ok(second.result);
    // A witness for a file with no call sites describes nothing, and a stale one would keep
    // typechecking against a type the source no longer mentions.
    expect(second.result.deleted.map(path => path.replaceAll(/^.*\//g, '')).toSorted()).toEqual([
      'app.zmdb.generated.d.ts',
      'app.zmdb.generated.js',
      'app.zmdb.witness.ts',
    ]);
  });
});

// -----------------------------------------------------------------------------
// --watch
// -----------------------------------------------------------------------------

describe('--watch', () => {
  it('regenerates on a save, on the session it already has', async () => {
    // `--watch` is the mode a person actually develops in, and it had no test: the loop keeps
    // one compiler session open and tells it what changed rather than reloading, so every
    // pass after the first goes through a code path a single `codegen()` call never takes.
    // The observable claim is that a save produces the generated files and rewrites the call.
    const { src, tsconfig } = project('export const nothing = (): boolean => true;\n');

    const stop = Promise.withResolvers<void>();
    const lines: string[] = [];
    const watching = watchCodegen({
      project: tsconfig,
      log: line => lines.push(line),
      until: stop.promise,
      debounceMs: 10,
    });

    // The first pass has already run by the time the watcher parks, but the parking itself is
    // a microtask away, so the edit waits for the event loop to get there.
    await new Promise(resolve => setTimeout(resolve, 100));
    writeFileSync(
      join(src, 'app.ts'),
      `import { is } from '@zmdb/aot-validator/utilities';

import type { Order } from './model.js';

export const accepts = (value: unknown): boolean => is<Order>(value);
`,
    );

    const generated = join(src, 'app.zmdb.generated.js');
    const deadline = Date.now() + 20_000;
    while (!existsSync(generated) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    stop.resolve();
    const result = await watching;

    expect(existsSync(generated)).toBe(true);
    ok(result);
    expect(readFileSync(join(src, 'app.ts'), 'utf8')).toContain('zmdbIsOrder(value)');
    // The first pass found nothing to do, which is what the run before the edit should say.
    expect(lines[0]).toBe('up to date');
  }, 30_000);
});

// -----------------------------------------------------------------------------
// A session the caller owns
// -----------------------------------------------------------------------------

const APP = `import { is } from '@zmdb/aot-validator/utilities';

import type { Order } from './model.js';

export const accepts = (value: unknown): boolean => is<Order>(value);
`;

describe('a session the caller owns', () => {
  // The plugin has taken a borrowed session from the start; the CLI's path did not, and a tool
  // that has the project loaded already should not pay to load it again — that is REQ-TF-11
  // pointed at the caller rather than at the file loop. It is also what `verify:build-budget`
  // needs in order to watch a build from outside it.

  it('is used rather than a second one, and is still open afterwards', () => {
    const { src, tsconfig } = project(APP);
    const before = apiInstanceCount();
    using session = ReflectSession.open({ project: tsconfig });
    ok(codegen({ project: tsconfig, session }));

    // One compiler for the whole thing: the session opened above, and none from `codegen`.
    expect(apiInstanceCount() - before).toBe(1);
    expect(readFileSync(join(src, 'app.ts'), 'utf8')).toContain('zmdbIsOrder(value)');
    // Closing it is the caller's business, so the caller can still use it. A closed session
    // throws on any snapshot update, which is what makes this observable at all.
    expect(() => session.refresh([join(src, 'app.ts')])).not.toThrow();
  }, 60_000);

  it('survives a watch that borrowed it', async () => {
    const { src, tsconfig } = project(APP);
    using session = ReflectSession.open({ project: tsconfig });

    const stop = Promise.withResolvers<void>();
    const watching = watchCodegen({ project: tsconfig, session, until: stop.promise, debounceMs: 10 });
    await new Promise(resolve => setTimeout(resolve, 100));
    stop.resolve();
    ok(await watching);

    // `watchCodegen` closes the session it opened itself. This one it did not open.
    expect(() => session.refresh([join(src, 'app.ts')])).not.toThrow();
  }, 60_000);
});
