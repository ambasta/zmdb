import { parseArgs } from 'node:util';

import type { JsonSchemaObject } from '@zmdb/schema-core/ir';
import { createToken, Inject, type Container } from '@zmdb/web/di';
import { compileModule, Module, type ModuleClass } from '@zmdb/web/modules';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Command, createCommandApp, type CommandApp } from './index.js';

// Regression coverage for packages/web/src/cli/SPEC.md. These tests were frozen as expected
// failures in #499 and became ordinary assertions when #501 supplied the real public surface.

function metadataFor(target: Function): DecoratorMetadata {
  const existing = target[Symbol.metadata];
  if (existing !== undefined && existing !== null) return existing;
  const metadata: DecoratorMetadata = Object.create(null);
  Object.defineProperty(target, Symbol.metadata, { configurable: true, value: metadata });
  return metadata;
}

function applyClassDecorator<T extends abstract new (...args: never[]) => unknown>(
  target: T,
  decorator: (target: T, context: ClassDecoratorContext<T>) => void,
): void {
  const initializers: ((this: T) => void)[] = [];
  decorator(target, {
    kind: 'class',
    name: target.name,
    metadata: metadataFor(target),
    addInitializer(initializer) {
      initializers.push(initializer);
    },
  });
  for (const initializer of initializers) initializer.call(target);
}

function applyFieldDecorator<T>(
  target: Function,
  name: string,
  decorator: (value: undefined, context: ClassFieldDecoratorContext<unknown, T>) => (initialValue: T) => T,
): (initialValue: T) => T {
  const initializers: ((this: unknown) => void)[] = [];
  const initialize = decorator(undefined, {
    kind: 'field',
    name,
    static: false,
    private: false,
    metadata: metadataFor(target),
    access: {
      has(object) {
        return Reflect.has(Object(object), name);
      },
      get(object) {
        return Reflect.get(Object(object), name);
      },
      set(object, value) {
        Reflect.set(Object(object), name, value);
      },
    },
    addInitializer(initializer) {
      initializers.push(initializer);
    },
  });
  return function initializeField(this: unknown, initialValue: T): T {
    const value = initialize(initialValue);
    for (const initializer of initializers) initializer.call(this);
    return value;
  };
}

interface ImportArgs {
  readonly file: string;
  readonly dryRun?: boolean;
  readonly tag?: readonly string[];
  readonly limit?: number;
  readonly v2Api?: boolean;
}

const importArgsDocument: JsonSchemaObject = {
  type: 'object',
  properties: {
    dryRun: { type: 'boolean' },
    file: { type: 'string', minLength: 1 },
    limit: { type: 'number' },
    tag: { type: 'array', items: { type: 'string' } },
    v2Api: { type: 'boolean' },
  },
  required: ['file'],
};

let seenRaw: unknown[] = [];
let seenArgs: ImportArgs[] = [];
let validationOverride: ImportArgs | undefined;

function validateImportArgs(raw: unknown): ImportArgs {
  seenRaw.push(raw);
  if (validationOverride !== undefined) {
    return validationOverride;
  }
  const record = Object(raw);
  const file = Reflect.get(record, 'file');
  const dryRun = Reflect.get(record, 'dryRun');
  const tag = Reflect.get(record, 'tag');
  const limit = Reflect.get(record, 'limit');
  const v2Api = Reflect.get(record, 'v2Api');
  if (typeof file !== 'string' || file.length === 0) {
    throw new Error('file is required');
  }
  if (dryRun !== undefined && typeof dryRun !== 'boolean') {
    throw new Error('dryRun must be boolean');
  }
  if (tag !== undefined && (!Array.isArray(tag) || !tag.every(value => typeof value === 'string'))) {
    throw new Error('tag must be an array of strings');
  }
  if (limit !== undefined && typeof limit !== 'number') {
    throw new Error('limit must be a number');
  }
  if (v2Api !== undefined && typeof v2Api !== 'boolean') {
    throw new Error('v2Api must be boolean');
  }
  return {
    file,
    ...(dryRun === undefined ? {} : { dryRun }),
    ...(tag === undefined ? {} : { tag }),
    ...(limit === undefined ? {} : { limit }),
    ...(v2Api === undefined ? {} : { v2Api }),
  };
}

class ImportUsers {
  run(args: ImportArgs): number {
    seenArgs.push(args);
    return 0;
  }
}
applyClassDecorator(
  ImportUsers,
  Command<ImportArgs>({
    name: 'import-users',
    description: 'Load users from a CSV',
    args: importArgsDocument,
    validate: validateImportArgs,
    positionals: ['file'],
  }),
);

class StatusCommand {
  run(): void {}
}
applyClassDecorator(StatusCommand, Command<void>({ name: 'status', description: 'Print status' }));

class ImportModule {
  readonly name = 'import';
}
applyClassDecorator(ImportModule, Module({ commands: [ImportUsers] }));

class MultipleCommandsModule {
  readonly name = 'multiple-commands';
}
applyClassDecorator(MultipleCommandsModule, Module({ commands: [ImportUsers, StatusCommand] }));

interface NestedObjectArgs {
  readonly config: { readonly region: string };
}

class NestedObjectCommand {
  run(_args: NestedObjectArgs): void {}
}
applyClassDecorator(
  NestedObjectCommand,
  Command<NestedObjectArgs>({
    name: 'nested-object',
    description: 'Invalid nested object fixture',
    args: {
      type: 'object',
      properties: { config: { type: 'object', properties: { region: { type: 'string' } } } },
      required: ['config'],
    },
    validate: raw => ({ config: Object(Reflect.get(Object(raw), 'config')) }),
  }),
);

interface NestedArrayArgs {
  readonly rows: readonly { readonly id: number }[];
}

class NestedArrayCommand {
  run(_args: NestedArrayArgs): void {}
}
applyClassDecorator(
  NestedArrayCommand,
  Command<NestedArrayArgs>({
    name: 'nested-array',
    description: 'Invalid nested array fixture',
    args: {
      type: 'object',
      properties: { rows: { type: 'array', items: { type: 'object' } } },
      required: ['rows'],
    },
    validate: () => ({ rows: [] }),
  }),
);

class NestedObjectModule {
  readonly name = 'nested-object';
}
applyClassDecorator(NestedObjectModule, Module({ commands: [NestedObjectCommand] }));

class NestedArrayModule {
  readonly name = 'nested-array';
}
applyClassDecorator(NestedArrayModule, Module({ commands: [NestedArrayCommand] }));

let exitResult: unknown;

class ResultCommand {
  run(): unknown {
    if (exitResult instanceof Error) {
      throw exitResult;
    }
    return exitResult;
  }
}
applyClassDecorator(ResultCommand, Command<void>({ name: 'result', description: 'Return the fixture result' }));

class ResultModule {
  readonly name = 'result';
}
applyClassDecorator(ResultModule, Module({ commands: [ResultCommand] }));

const REPOSITORY = createToken<{ readonly name: string; readonly events?: string[] }>('REPOSITORY');
const UNUSED = createToken<object>('UNUSED');
const sharedRepository = { name: 'shared' };
const uninitializedRepository = { name: 'uninitialized' };
let injectedRepository: object | undefined;

let initializeInjectedCommandRepository = (initialValue: {
  readonly name: string;
  readonly events?: string[];
}): { readonly name: string; readonly events?: string[] } => initialValue;

class InjectedCommand {
  readonly repository = initializeInjectedCommandRepository(uninitializedRepository);

  run(): void {
    injectedRepository = this.repository;
  }
}
initializeInjectedCommandRepository = applyFieldDecorator(InjectedCommand, 'repository', Inject(REPOSITORY));
applyClassDecorator(InjectedCommand, Command<void>({ name: 'injected', description: 'Use the repository' }));

let initializeInjectedControllerRepository = (initialValue: {
  readonly name: string;
  readonly events?: string[];
}): { readonly name: string; readonly events?: string[] } => initialValue;
class InjectedController {
  readonly repository = initializeInjectedControllerRepository(uninitializedRepository);
}
initializeInjectedControllerRepository = applyFieldDecorator(InjectedController, 'repository', Inject(REPOSITORY));

class InjectedModule {
  readonly name = 'injected';
}
applyClassDecorator(
  InjectedModule,
  Module({
    providers: [{ token: REPOSITORY, useValue: sharedRepository }],
    controllers: [InjectedController],
    commands: [InjectedCommand],
  }),
);

let lifecycleEvents: string[] = [];
let unusedFactoryCalls = 0;

let initializeLifecycleRepository = (initialValue: {
  readonly name: string;
  readonly events?: string[];
}): { readonly name: string; readonly events?: string[] } => initialValue;
class LifecycleCommand {
  readonly repository = initializeLifecycleRepository(uninitializedRepository);

  onModuleInit(): void {
    lifecycleEvents.push('command:init');
  }

  run(): void {
    lifecycleEvents.push(`command:run:${this.repository.name}`);
  }

  onShutdown(): void {
    lifecycleEvents.push('command:shutdown');
  }
}
initializeLifecycleRepository = applyFieldDecorator(LifecycleCommand, 'repository', Inject(REPOSITORY));
applyClassDecorator(LifecycleCommand, Command<void>({ name: 'lifecycle', description: 'Exercise lifecycle ordering' }));

class LifecycleModule {
  readonly name = 'lifecycle';
}
applyClassDecorator(
  LifecycleModule,
  Module({
    providers: [
      {
        token: REPOSITORY,
        useFactory: () => ({
          name: 'lifecycle-repository',
          onModuleInit(): void {
            lifecycleEvents.push('provider:init');
          },
          onShutdown(): void {
            lifecycleEvents.push('provider:shutdown');
          },
        }),
      },
      {
        token: UNUSED,
        useFactory: () => {
          unusedFactoryCalls += 1;
          return {};
        },
      },
    ],
    commands: [LifecycleCommand],
  }),
);

interface Execution {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly container: Container;
}

async function execute(rootModule: ModuleClass, argv: readonly string[]): Promise<Execution> {
  let stdout = '';
  let stderr = '';
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    stdout += String(chunk);
    return true;
  });
  const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    stderr += String(chunk);
    return true;
  });
  let app: CommandApp | undefined;
  try {
    app = createCommandApp(rootModule);
    await app.init();
    const code = await app.run(argv);
    return { code, stdout, stderr, container: app.container };
  } finally {
    if (app !== undefined) {
      await app[Symbol.asyncDispose]();
    }
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  }
}

beforeEach(() => {
  seenRaw = [];
  seenArgs = [];
  validationOverride = undefined;
  exitResult = undefined;
  injectedRepository = undefined;
  lifecycleEvents = [];
  unusedFactoryCalls = 0;
  vi.restoreAllMocks();
});

describe('command argv mapping (frozen: web cli SPEC §3-§4)', () => {
  it('maps every argv convention onto the args DTO', async () => {
    const cases: readonly {
      readonly name: string;
      readonly argv: readonly string[];
      readonly expected: ImportArgs;
    }[] = [
      {
        name: 'kebab-case boolean',
        argv: ['import-users', 'users.csv', '--dry-run'],
        expected: { file: 'users.csv', dryRun: true },
      },
      {
        name: 'negative boolean',
        argv: ['import-users', 'users.csv', '--no-dry-run'],
        expected: { file: 'users.csv', dryRun: false },
      },
      {
        name: 'repeated array',
        argv: ['import-users', 'users.csv', '--tag', 'a', '--tag', 'b'],
        expected: { file: 'users.csv', tag: ['a', 'b'] },
      },
      {
        name: 'singleton array',
        argv: ['import-users', 'users.csv', '--tag', 'a'],
        expected: { file: 'users.csv', tag: ['a'] },
      },
      {
        name: 'number coercion',
        argv: ['import-users', 'users.csv', '--limit', '100'],
        expected: { file: 'users.csv', limit: 100 },
      },
      {
        name: 'named positional',
        argv: ['import-users', 'users.csv'],
        expected: { file: 'users.csv' },
      },
      {
        name: 'terminator passthrough excluded from DTO',
        argv: ['import-users', 'users.csv', '--', '--raw', '--flags'],
        expected: { file: 'users.csv' },
      },
      {
        name: 'help after terminator stays passthrough',
        argv: ['import-users', 'users.csv', '--', '--help'],
        expected: { file: 'users.csv' },
      },
      {
        name: 'digit boundary',
        argv: ['import-users', 'users.csv', '--v2-api'],
        expected: { file: 'users.csv', v2Api: true },
      },
    ];

    const actual: unknown[] = [];
    for (const testCase of cases) {
      seenRaw = [];
      seenArgs = [];
      try {
        const result = await execute(ImportModule, testCase.argv);
        actual.push({ name: testCase.name, code: result.code, args: [...seenArgs] });
      } catch (error) {
        actual.push({
          name: testCase.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    expect(actual).toEqual(
      cases.map(testCase => ({
        name: testCase.name,
        code: 0,
        args: [testCase.expected],
      })),
    );
  });
});

describe('command validation and registration (frozen: web cli SPEC §3-§4)', () => {
  it('reports an unknown flag as a usage error with command help', async () => {
    const result = await execute(ImportModule, ['import-users', 'users.csv', '--wat']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('unknown option');
    expect(result.stderr).toContain('--wat');
    expect(result.stderr).toContain('import-users');
    expect(result.stdout).toBe('');
    expect(seenArgs).toEqual([]);
  });

  it('hands run the exact object returned by validate', async () => {
    const narrowed: ImportArgs = { file: 'validated.csv', limit: 7 };
    validationOverride = narrowed;
    await execute(ImportModule, ['import-users', 'raw.csv', '--limit', '99']);
    expect(seenArgs).toHaveLength(1);
    expect(seenArgs[0]).toBe(narrowed);
  });

  it('validates command arguments with the emitted validator and reports a usage error', async () => {
    const result = await execute(ImportModule, ['import-users']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('file');
    expect(result.stderr).toMatch(/required|usage/i);
    expect(result.stderr).not.toContain('ImportUsers.run');
    expect(seenRaw).toHaveLength(1);
    expect(seenArgs).toEqual([]);
  });

  it('refuses a nested object argument at registration and names the property', () => {
    expect(() => createCommandApp(NestedObjectModule)).toThrow(/config.*nested|nested.*config/i);
  });

  it('refuses an array of objects at registration and names the property', () => {
    expect(() => createCommandApp(NestedArrayModule)).toThrow(/rows.*nested|nested.*rows/i);
  });

  it('derives --help from the args type', async () => {
    const result = await execute(ImportModule, ['import-users', '--help']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('import-users <file>');
    const flags = ['--dry-run', '--limit', '--tag', '--v2-api'];
    const positions = flags.map(flag => result.stdout.indexOf(flag));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual(positions.toSorted((left, right) => left - right));
  });
});

describe('command dispatch and help (frozen: web cli SPEC §7)', () => {
  it('lists every command and description when no name is supplied', async () => {
    const result = await execute(MultipleCommandsModule, []);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('import-users');
    expect(result.stdout).toContain('Load users from a CSV');
    expect(result.stdout).toContain('status');
    expect(result.stdout).toContain('Print status');
  });

  it('lists commands on an unknown name and exits 2', async () => {
    const result = await execute(MultipleCommandsModule, ['missing']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('missing');
    expect(result.stderr).toContain('import-users');
    expect(result.stderr).toContain('status');
  });

  it('lets a single registered command omit its name', async () => {
    const result = await execute(ImportModule, ['users.csv']);
    expect(result.code).toBe(0);
    expect(seenArgs).toEqual([{ file: 'users.csv' }]);
  });

  it('writes command help to stdout and exits 0', async () => {
    const result = await execute(ImportModule, ['import-users', '--help']);
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toContain('Load users from a CSV');
    expect(result.stdout).toContain('--dry-run');
  });
});

describe('command return values (frozen: web cli SPEC §5)', () => {
  it("returns the command's exit code from its return value", async () => {
    const cases = [
      { name: 'void', value: undefined, expected: 0 },
      { name: 'negative number', value: -1, expected: 0 },
      { name: 'fractional number', value: 3.9, expected: 3 },
      { name: 'number above 255', value: 999, expected: 255 },
      { name: 'true', value: true, expected: 0 },
      { name: 'false', value: false, expected: 1 },
    ] as const;
    const actual: unknown[] = [];

    for (const testCase of cases) {
      exitResult = testCase.value;
      try {
        actual.push({ name: testCase.name, code: (await execute(ResultModule, ['result'])).code });
      } catch (error) {
        actual.push({
          name: testCase.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    expect(actual).toEqual(cases.map(testCase => ({ name: testCase.name, code: testCase.expected })));
  });

  it('maps a thrown error to exit 1 and readable stderr', async () => {
    exitResult = new Error('fixture exploded');
    const result = await execute(ResultModule, ['result']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('fixture exploded');
    expect(result.stderr).not.toContain('ResultCommand.run');
  });
});

describe('command DI and lifecycle (frozen: web cli SPEC §6-§7)', () => {
  it('the frozen decorator vehicle builds a real injected controller', () => {
    const compiled = compileModule(InjectedModule);
    const controller = compiled.controllers.find(value => value instanceof InjectedController);
    expect(controller).toBeInstanceOf(InjectedController);
    expect(controller instanceof InjectedController ? controller.repository : undefined).toBe(sharedRepository);
  });

  it('injects a repository into a command through the compile-time container', () => {
    const compiled = compileModule(InjectedModule);
    const commands = compiled.commands;
    expect(commands).toHaveLength(1);
    expect(commands?.[0]).toBeInstanceOf(InjectedCommand);
    expect(compiled.controllers).toHaveLength(1);
    expect(compiled.controllers[0]).toBeInstanceOf(InjectedController);
    const command = commands?.[0];
    expect(command instanceof InjectedCommand ? command.repository : undefined).toBe(sharedRepository);
  });

  it('shares one singleton provider between a controller and a command', async () => {
    const result = await execute(InjectedModule, ['injected']);
    const compiled = compileModule(InjectedModule);
    const controller = compiled.controllers.find(value => value instanceof InjectedController);
    expect(injectedRepository).toBe(sharedRepository);
    expect(controller instanceof InjectedController ? controller.repository : undefined).toBe(sharedRepository);
    expect(result.container.resolve(REPOSITORY)).toBe(sharedRepository);
  });

  it('runs provider and command init before dispatch', async () => {
    await execute(LifecycleModule, ['lifecycle']);
    expect(lifecycleEvents.slice(0, 3)).toEqual(['provider:init', 'command:init', 'command:run:lifecycle-repository']);
  });

  it('shuts a command down before the provider it resolved', async () => {
    await execute(LifecycleModule, ['lifecycle']);
    expect(lifecycleEvents.slice(-2)).toEqual(['command:shutdown', 'provider:shutdown']);
  });

  it('does not construct an unresolved provider merely to run lifecycle hooks', async () => {
    await execute(LifecycleModule, ['lifecycle']);
    expect(unusedFactoryCalls).toBe(0);
  });
});

describe('the Node parseArgs facts the frozen design rests on', () => {
  it('negates a boolean option and does not invent a negated string option', () => {
    const boolean = parseArgs({
      args: ['--no-dry-run'],
      allowNegative: true,
      options: { 'dry-run': { type: 'boolean' } },
    });
    expect(boolean.values['dry-run']).toBe(false);
    expect(() =>
      parseArgs({
        args: ['--no-file'],
        allowNegative: true,
        strict: true,
        options: { file: { type: 'string' } },
      }),
    ).toThrow(/Unknown option|unknown option/);
  });

  it('marks -- with an option-terminator token so passthrough can be separated', () => {
    const parsed = parseArgs({
      args: ['users.csv', '--', '--raw', '--flags'],
      allowPositionals: true,
      tokens: true,
    });
    expect(parsed.positionals).toEqual(['users.csv', '--raw', '--flags']);
    expect(parsed.tokens.map(token => token.kind)).toEqual([
      'positional',
      'option-terminator',
      'positional',
      'positional',
    ]);
    expect(parsed.tokens.find(token => token.kind === 'option-terminator')?.index).toBe(1);
  });
});
