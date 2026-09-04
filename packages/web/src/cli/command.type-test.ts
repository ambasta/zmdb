// Type-level freeze for packages/web/src/cli/SPEC.md §2 and modules/SPEC.md's pending
// `commands` key (#499). `@zmdb/web/cli` does not exist at HEAD 83cb5c25, so the surface is
// transcribed here. When #501 lands, replace this block with imports from './index.js' and keep
// the assertions unchanged.
//
// This file is compiled by `node scripts/typecheck.mjs` and is not a Vitest test file. Every
// `@ts-expect-error` is therefore checked by TS2578 if the forbidden shape becomes legal.

import type { Equal, Expect } from '@zmdb/schema-core';
import type { JsonSchemaObject } from '@zmdb/schema-core/ir';
import type { Constructor, Container } from '@zmdb/web/di';
import type { CompiledModule, ModuleClass, ModuleDef } from '@zmdb/web/modules';

interface CommandDef<A> {
  readonly name: string;
  readonly description: string;
  readonly args?: JsonSchemaObject;
  readonly validate?: (raw: unknown) => A;
  readonly positionals?: readonly string[];
}

type CommandClass<A> = abstract new () => { run(args: A): unknown };

type CommandDecorator = <A>(
  def: CommandDef<A>,
) => <T extends CommandClass<A>>(target: T, context: ClassDecoratorContext<T>) => void;

interface CommandApp extends AsyncDisposable {
  readonly container: Container;
  run(argv?: readonly string[]): Promise<number>;
  init(): Promise<void>;
}

type CreateCommandApp = (rootModule: ModuleClass) => CommandApp;
type FrozenModuleDef = ModuleDef & { readonly commands?: readonly Constructor<object>[] };
type FrozenCompiledModule = CompiledModule & { readonly commands: readonly object[] };

interface ImportArgs {
  readonly file: string;
  readonly dryRun?: boolean;
}

type FrozenDefKeys = 'name' | 'description' | 'args' | 'validate' | 'positionals';

const Command: CommandDecorator = _definition => {
  return (_target, _context): void => {};
};

export type _CommandDefKeys = Expect<Equal<keyof CommandDef<ImportArgs>, FrozenDefKeys>>;
export type _ArgsDocument = Expect<Equal<CommandDef<ImportArgs>['args'], JsonSchemaObject | undefined>>;
export type _Validator = Expect<Equal<CommandDef<ImportArgs>['validate'], ((raw: unknown) => ImportArgs) | undefined>>;
export type _Positionals = Expect<Equal<CommandDef<ImportArgs>['positionals'], readonly string[] | undefined>>;
export type _CommandInstance = Expect<
  Equal<InstanceType<CommandClass<ImportArgs>>, { run(args: ImportArgs): unknown }>
>;
export type _Decorator = Expect<Equal<typeof Command, CommandDecorator>>;
export type _AppKeys = Expect<Equal<keyof CommandApp, 'container' | 'run' | 'init' | typeof Symbol.asyncDispose>>;
export type _RunArgument = Expect<Equal<Parameters<CommandApp['run']>, [argv?: readonly string[] | undefined]>>;
export type _RunReturn = Expect<Equal<ReturnType<CommandApp['run']>, Promise<number>>>;
export type _InitReturn = Expect<Equal<ReturnType<CommandApp['init']>, Promise<void>>>;
export type _DisposeReturn = Expect<Equal<ReturnType<CommandApp[typeof Symbol.asyncDispose]>, PromiseLike<void>>>;
export type _CreateSignature = Expect<Equal<CreateCommandApp, (rootModule: ModuleClass) => CommandApp>>;
export type _ModuleCommands = Expect<Equal<FrozenModuleDef['commands'], readonly Constructor<object>[] | undefined>>;
export type _CompiledCommands = Expect<Equal<FrozenCompiledModule['commands'], readonly object[]>>;

class RootModule {
  readonly name = 'root';
}

class ImportUsers {
  run(_args: ImportArgs): void {}
}

const createCommandApp: CreateCommandApp = _rootModule => {
  throw new Error('#499 type freeze: createCommandApp is unimplemented');
};

const importUsers: CommandClass<ImportArgs> = ImportUsers;
void importUsers;
void createCommandApp(RootModule);

// @ts-expect-error — cli SPEC §2: createCommandApp takes a ModuleClass, never an arbitrary value
void createCommandApp('not a module');

// @ts-expect-error — cli SPEC §2: a command definition always has a stable name
const missingName: CommandDef<ImportArgs> = { description: 'missing name' };
void missingName;

// @ts-expect-error — cli SPEC §2: validate narrows unknown to the command's exact args type
const wrongValidator: NonNullable<CommandDef<ImportArgs>['validate']> = () => ({ file: 42 });
void wrongValidator;

class ConstructorInjected {
  constructor(readonly dependency: string) {}
  run(_args: ImportArgs): void {}
}

// @ts-expect-error — cli SPEC §1: CommandClass has a zero-argument constructor; injection is by field
const constructorInjected: CommandClass<ImportArgs> = ConstructorInjected;
void constructorInjected;

class WrongArgs {
  run(_args: { readonly count: number }): void {}
}

// @ts-expect-error — cli SPEC §2: run receives the A named by CommandDef<A>
const wrongArgs: CommandClass<ImportArgs> = WrongArgs;
void wrongArgs;

function rejectsNumericArgv(app: CommandApp): void {
  // @ts-expect-error — cli SPEC §2: argv is a readonly list of strings
  void app.run([1, 2, 3]);
}
void rejectsNumericArgv;
