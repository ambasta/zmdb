// @zmdb/app — command applications (epic #497, spec ./SPEC.md).
// Commands use the same module compilation, container and lifecycle as
// createApplication, with argv validation at the terminal boundary and no
// runtime reflection or HTTP router.

import type { ParseArgsConfig } from 'node:util';

import { coerce } from '@zmdb/aot-validator/advanced';
import type { JsonSchemaObject } from '@zmdb/schema-core/ir';

import { applicationBridgeOf, createApplication } from '../application.js';
import type { Container } from '../di/index.js';
import type { ModuleClass } from '../modules/index.js';
import '../polyfill.js';

/** Declaration recorded by `@Command`. */
export interface CommandDef<A> {
  readonly name: string;
  readonly description: string;
  readonly args?: JsonSchemaObject;
  readonly validate?: (raw: unknown) => A;
  readonly positionals?: readonly string[];
}

/** A zero-argument command class; dependencies arrive through `@Inject` fields. */
export type CommandClass<A> = abstract new () => { run(args: A): unknown };

/** A module graph driven from argv rather than an HTTP request. */
export interface CommandApp extends AsyncDisposable {
  readonly container: Container;
  run(argv?: readonly string[]): Promise<number>;
  init(): Promise<void>;
}

const COMMAND = Symbol('zmdb.app.command');

interface CommandMetadata {
  [COMMAND]?: CommandDef<unknown>;
}

interface MetadataCarrier {
  readonly [Symbol.metadata]?: DecoratorMetadata | null;
}

interface RunnableCommand {
  run(args: unknown): unknown;
}

interface ArgumentProperty {
  readonly name: string;
  readonly option: string;
  readonly parseType: 'boolean' | 'string';
  readonly multiple: boolean;
  readonly numeric: boolean;
}

interface RegisteredCommand {
  readonly definition: CommandDef<unknown>;
  readonly instance: RunnableCommand;
  readonly properties: readonly ArgumentProperty[];
  readonly propertyByName: ReadonlyMap<string, ArgumentProperty>;
  readonly positionals: readonly string[];
}

interface PositionalParts {
  readonly positionals: readonly string[];
  readonly passthrough: readonly string[];
}

function commandView(metadata: DecoratorMetadata): CommandMetadata {
  return metadata;
}

/** Stage-3 class decorator: record one command declaration in `context.metadata`. */
export function Command<A>(
  def: CommandDef<A>,
): <T extends CommandClass<A>>(target: T, context: ClassDecoratorContext<T>) => void {
  return function <T extends CommandClass<A>>(_target: T, context: ClassDecoratorContext<T>): void {
    commandView(context.metadata)[COMMAND] = def;
  };
}

/**
 * Compile a root module through `createApplication`, then dispatch its declared
 * commands. The returned app never calls `process.exit`; callers own
 * `process.exitCode`.
 */
export function createCommandApp(rootModule: ModuleClass): CommandApp {
  const application = createApplication(rootModule);
  const commands = registerCommands(applicationBridgeOf(application).compiled.commands);

  return {
    container: application.container,
    init: application.init,
    run: (argv = process.argv.slice(2)) => runCommand(commands, argv),
    [Symbol.asyncDispose]: application[Symbol.asyncDispose],
  };
}

function registerCommands(instances: readonly object[]): readonly RegisteredCommand[] {
  const commands: RegisteredCommand[] = [];
  const names = new Set<string>();
  for (const instance of instances) {
    const definition = commandDefinitionOf(instance);
    if (definition === undefined) {
      throw new Error(`@zmdb/app: ${instance.constructor.name} is listed in commands but has no @Command declaration`);
    }
    if (!isRunnableCommand(instance)) {
      throw new Error(`@zmdb/app: command "${definition.name}" has no run(args) method`);
    }
    if (definition.name.length === 0) {
      throw new Error('@zmdb/app: a command name cannot be empty');
    }
    if (names.has(definition.name)) {
      throw new Error(`@zmdb/app: duplicate command name "${definition.name}"`);
    }
    names.add(definition.name);
    commands.push(prepareCommand(instance, definition));
  }
  return commands;
}

function commandDefinitionOf(instance: object): CommandDef<unknown> | undefined {
  const carrier: MetadataCarrier = instance.constructor;
  const metadata = carrier[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return undefined;
  }
  return commandView(metadata)[COMMAND];
}

function isRunnableCommand(instance: object): instance is RunnableCommand {
  return 'run' in instance && typeof instance.run === 'function';
}

function prepareCommand(instance: RunnableCommand, definition: CommandDef<unknown>): RegisteredCommand {
  const positionals = [...(definition.positionals ?? [])];
  const properties =
    definition.args === undefined
      ? []
      : Object.entries(definition.args.properties)
          .map(([name, schema]) => argumentProperty(definition.name, name, schema))
          .toSorted((left, right) => left.option.localeCompare(right.option));
  const propertyByName = new Map(properties.map(property => [property.name, property]));
  const seenPositionals = new Set<string>();

  for (const positional of positionals) {
    if (seenPositionals.has(positional)) {
      throw new Error(`@zmdb/app: command "${definition.name}" repeats positional "${positional}"`);
    }
    seenPositionals.add(positional);
    if (definition.args !== undefined && !propertyByName.has(positional)) {
      throw new Error(
        `@zmdb/app: command "${definition.name}" names positional "${positional}" but its args type has no such property`,
      );
    }
  }

  const optionNames = new Set<string>();
  for (const property of properties) {
    if (optionNames.has(property.option)) {
      throw new Error(`@zmdb/app: command "${definition.name}" maps more than one property to --${property.option}`);
    }
    optionNames.add(property.option);
  }

  return { definition, instance, properties, propertyByName, positionals };
}

function argumentProperty(command: string, name: string, schema: unknown): ArgumentProperty {
  const types = schemaTypes(schema);
  if (types.includes('object')) {
    throw nestedArgument(command, name);
  }
  if (types.includes('array')) {
    const items = schemaKeyword(schema, 'items');
    const itemTypes = schemaTypes(items);
    if (itemTypes.length === 0 || itemTypes.includes('object') || itemTypes.includes('array')) {
      throw nestedArgument(command, name);
    }
    const itemType = scalarType(itemTypes);
    return {
      name,
      option: kebabCase(name),
      parseType: itemType === 'boolean' ? 'boolean' : 'string',
      multiple: true,
      numeric: itemType === 'number' || itemType === 'integer',
    };
  }
  if (schemaKeyword(schema, 'properties') !== undefined || schemaKeyword(schema, '$ref') !== undefined) {
    throw nestedArgument(command, name);
  }
  const type = scalarType(types);
  return {
    name,
    option: kebabCase(name),
    parseType: type === 'boolean' ? 'boolean' : 'string',
    multiple: false,
    numeric: type === 'number' || type === 'integer',
  };
}

function nestedArgument(command: string, property: string): Error {
  return new Error(`@zmdb/app: command "${command}" argument "${property}" has a nested shape; argv must be flat`);
}

function schemaTypes(schema: unknown): readonly string[] {
  const type = schemaKeyword(schema, 'type');
  if (typeof type === 'string') {
    return [type];
  }
  if (Array.isArray(type)) {
    return type.filter(value => typeof value === 'string' && value !== 'null');
  }
  return [];
}

function schemaKeyword(schema: unknown, keyword: string): unknown {
  return typeof schema === 'object' && schema !== null ? Reflect.get(schema, keyword) : undefined;
}

function scalarType(types: readonly string[]): string | undefined {
  return types.find(type => type !== 'null');
}

function kebabCase(name: string): string {
  return name.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

async function runCommand(commands: readonly RegisteredCommand[], argv: readonly string[]): Promise<number> {
  const selected = selectCommand(commands, argv);
  if (selected.kind === 'list') {
    process.stdout.write(commandList(commands));
    return 0;
  }
  if (selected.kind === 'unknown') {
    process.stderr.write(`unknown command "${selected.name}"\n\n${commandList(commands)}`);
    return 2;
  }
  if (selected.help) {
    process.stdout.write(commandHelp(selected.command));
    return 0;
  }

  let args: unknown;
  try {
    args = commandArguments(selected.command, selected.argv);
  } catch (error) {
    process.stderr.write(`${lowerFirst(errorMessage(error))}\n\n${commandHelp(selected.command)}`);
    return 2;
  }

  try {
    const result = await selected.command.instance.run(args);
    return exitCode(result);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }
}

type CommandSelection =
  | { readonly kind: 'list' }
  | { readonly kind: 'unknown'; readonly name: string }
  | {
      readonly kind: 'command';
      readonly command: RegisteredCommand;
      readonly argv: readonly string[];
      readonly help: boolean;
    };

function selectCommand(commands: readonly RegisteredCommand[], argv: readonly string[]): CommandSelection {
  if (commands.length === 1) {
    const command = commands[0];
    if (command === undefined) {
      return { kind: 'list' };
    }
    const named = argv[0] === command.definition.name;
    const commandArgv = named ? argv.slice(1) : argv;
    return {
      kind: 'command',
      command,
      argv: commandArgv,
      help: requestsHelp(commandArgv),
    };
  }

  const name = argv[0];
  if (name === undefined || name === '--help') {
    return { kind: 'list' };
  }
  const command = commands.find(candidate => candidate.definition.name === name);
  if (command === undefined) {
    return { kind: 'unknown', name };
  }
  const commandArgv = argv.slice(1);
  return {
    kind: 'command',
    command,
    argv: commandArgv,
    help: requestsHelp(commandArgv),
  };
}

function requestsHelp(argv: readonly string[]): boolean {
  const terminator = argv.indexOf('--');
  const beforeTerminator = terminator === -1 ? argv : argv.slice(0, terminator);
  return beforeTerminator.includes('--help');
}

function parseCommandArgs<T extends ParseArgsConfig>(config: T) {
  return process.getBuiltinModule('node:util').parseArgs(config);
}

function commandArguments(command: RegisteredCommand, argv: readonly string[]): unknown {
  if (command.definition.args === undefined) {
    const parsed = parseCommandArgs({
      args: argv,
      allowNegative: true,
      allowPositionals: true,
      strict: false,
      tokens: true,
    });
    const parts = positionalParts(parsed.tokens);
    const raw = {
      values: parsed.values,
      positionals: parts.positionals,
      passthrough: parts.passthrough,
    };
    return command.definition.validate === undefined ? raw : command.definition.validate(raw);
  }

  const positionalNames = new Set(command.positionals);
  const options: Record<string, { readonly type: 'boolean' | 'string'; readonly multiple?: boolean }> = {};
  for (const property of command.properties) {
    if (!positionalNames.has(property.name)) {
      options[property.option] = {
        type: property.parseType,
        ...(property.multiple ? { multiple: true } : {}),
      };
    }
  }

  const parsed = parseCommandArgs({
    args: argv,
    allowNegative: command.properties.some(property => property.parseType === 'boolean'),
    allowPositionals: true,
    options,
    strict: true,
    tokens: true,
  });
  const parts = positionalParts(parsed.tokens);
  if (parts.positionals.length > command.positionals.length) {
    const unexpected = parts.positionals[command.positionals.length] ?? '';
    throw new Error(`unexpected positional argument "${unexpected}"`);
  }

  const raw: Record<string, unknown> = {};
  for (const property of command.properties) {
    if (positionalNames.has(property.name)) {
      continue;
    }
    const value = parsed.values[property.option];
    if (value !== undefined) {
      raw[property.name] = coerceArgument(property, value);
    }
  }
  for (const [index, name] of command.positionals.entries()) {
    const value = parts.positionals[index];
    if (value === undefined) {
      continue;
    }
    const property = command.propertyByName.get(name);
    raw[name] = property === undefined ? value : coerceArgument(property, value);
  }

  return command.definition.validate === undefined ? raw : command.definition.validate(raw);
}

function positionalParts(
  tokens: readonly { readonly kind: string; readonly value?: string | undefined }[],
): PositionalParts {
  const positionals: string[] = [];
  const passthrough: string[] = [];
  let afterTerminator = false;
  for (const token of tokens) {
    if (token.kind === 'option-terminator') {
      afterTerminator = true;
    } else if (token.kind === 'positional' && token.value !== undefined) {
      (afterTerminator ? passthrough : positionals).push(token.value);
    }
  }
  return { positionals, passthrough };
}

function coerceArgument(property: ArgumentProperty, value: string | boolean | readonly (string | boolean)[]): unknown {
  if (property.multiple) {
    const values = Array.isArray(value) ? value : [value];
    return property.numeric ? values.map(item => coerce.number(item)) : values;
  }
  return property.numeric ? coerce.number(value) : value;
}

function commandList(commands: readonly RegisteredCommand[]): string {
  const rows =
    commands.length === 0
      ? ['  (no commands registered)']
      : commands
          .toSorted((left, right) => left.definition.name.localeCompare(right.definition.name))
          .map(command => `  ${command.definition.name}  ${command.definition.description}`);
  return `Usage: <command> [options]\n\nCommands:\n${rows.join('\n')}\n`;
}

function commandHelp(command: RegisteredCommand): string {
  const required = new Set(command.definition.args?.required ?? []);
  const positionalNames = new Set(command.positionals);
  const positionalUsage = command.positionals.map(name => (required.has(name) ? `<${name}>` : `[${name}]`)).join(' ');
  const usage = `Usage: ${command.definition.name}${positionalUsage.length === 0 ? '' : ` ${positionalUsage}`}`;
  const options = command.properties
    .filter(property => !positionalNames.has(property.name))
    .map(property => {
      const value = property.parseType === 'boolean' ? '' : ` <value>${property.multiple ? '...' : ''}`;
      const marker = required.has(property.name) ? ' (required)' : '';
      return `  --${property.option}${value}${marker}`;
    });
  options.push('  --help');
  return `${usage}\n\n${command.definition.description}\n\nOptions:\n${options.join('\n')}\n`;
}

function exitCode(value: unknown): number {
  if (typeof value === 'boolean') {
    return value ? 0 : 1;
  }
  if (typeof value === 'number') {
    const integer = Math.floor(value);
    return Number.isNaN(integer) ? 1 : Math.max(0, Math.min(255, integer));
  }
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toLowerCase()}${value.slice(1)}`;
}
