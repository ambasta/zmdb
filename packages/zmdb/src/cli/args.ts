import { resolve } from 'node:path';
import { parseArgs, type ParseArgsOptionDescriptor, type ParseArgsOptionsConfig } from 'node:util';

interface OptionDefinition extends ParseArgsOptionDescriptor {
  readonly valueName?: string;
  readonly description: string;
}

type OptionDefinitions = Readonly<Record<string, OptionDefinition>>;

interface CommandDefinition {
  readonly usage: string;
  readonly summary: string;
  readonly options: OptionDefinitions;
  readonly maximumPositionals: number;
  readonly hidden?: boolean;
}

const COMMON_OPTIONS: OptionDefinitions = {
  config: {
    type: 'string',
    valueName: 'path',
    description: 'Use this config file instead of discovery.',
  },
  project: {
    type: 'string',
    valueName: 'tsconfig',
    description: "Override the config's TypeScript project.",
  },
  json: {
    type: 'boolean',
    description: 'Write one machine-readable result document to stdout.',
  },
  yes: {
    type: 'boolean',
    description: 'Answer permitted prompts without reading stdin.',
  },
  force: {
    type: 'boolean',
    description: 'Permit destructive database operations where supported.',
  },
  help: {
    type: 'boolean',
    short: 'h',
    description: 'Show help for this command.',
  },
  version: {
    type: 'boolean',
    description: 'Print the installed zmdb version.',
  },
};

const DATABASE_COMMANDS: Readonly<Record<string, CommandDefinition>> = {
  generate: {
    usage: 'zmdb generate [--name <slug>]',
    summary: 'Create a migration and update the stored snapshot.',
    options: {
      name: {
        type: 'string',
        valueName: 'slug',
        description: 'Name the migration; otherwise derive a name from the plan.',
      },
    },
    maximumPositionals: 0,
  },
  migrate: {
    usage: 'zmdb migrate',
    summary: 'Apply pending migrations.',
    options: {},
    maximumPositionals: 0,
  },
  rollback: {
    usage: 'zmdb rollback [--to <version>]',
    summary: 'Revert the latest migration or roll back to a version.',
    options: {
      to: {
        type: 'string',
        valueName: 'version',
        description: 'Revert down to, but not including, this version.',
      },
    },
    maximumPositionals: 0,
  },
  status: {
    usage: 'zmdb status',
    summary: 'List migration versions and their applied state.',
    options: {},
    maximumPositionals: 0,
  },
  push: {
    usage: 'zmdb push --force --yes',
    summary: 'Apply declaration changes directly to a development database.',
    options: {},
    maximumPositionals: 0,
  },
  check: {
    usage: 'zmdb check',
    summary: 'Report schema, migration and snapshot findings.',
    options: {},
    maximumPositionals: 0,
  },
  upgrade: {
    usage: 'zmdb upgrade',
    summary: 'Upgrade the stored snapshot format without touching a database.',
    options: {},
    maximumPositionals: 0,
  },
  export: {
    usage: 'zmdb export',
    summary: 'Print the declaration set as dialect DDL.',
    options: {},
    maximumPositionals: 0,
  },
  pull: {
    usage: 'zmdb pull',
    summary: 'Write declarations from a live database catalogue.',
    options: {},
    maximumPositionals: 0,
  },
  up: {
    usage: 'zmdb up',
    summary: 'Refused: use migrate for the database or upgrade for a snapshot.',
    options: {},
    maximumPositionals: 0,
    hidden: true,
  },
};

const APPLICATION_COMMANDS: Readonly<Record<string, CommandDefinition>> = {
  modules: {
    usage:
      'zmdb modules [path#export] [--format tree|dot] [--providers]\n' +
      '             [--module <name>] [--token <description>] [--depth <n>]',
    summary: 'Describe application declarations without constructing providers.',
    options: {
      format: {
        type: 'string',
        valueName: 'tree|dot',
        description: 'Choose the human-readable graph format.',
      },
      providers: {
        type: 'boolean',
        description: 'Include provider nodes.',
      },
      module: {
        type: 'string',
        valueName: 'name',
        description: 'Limit output to one module.',
      },
      token: {
        type: 'string',
        valueName: 'description',
        description: 'Limit output to providers matching a token description.',
      },
      depth: {
        type: 'string',
        valueName: 'n',
        description: 'Limit traversal to a non-negative depth.',
      },
    },
    maximumPositionals: 1,
  },
  repl: {
    usage: 'zmdb repl [path#export] [--no-history]',
    summary: 'Boot an application into a local interactive session.',
    options: {
      history: {
        type: 'boolean',
        default: true,
        description: 'Use private REPL history; pass --no-history to disable it.',
      },
    },
    maximumPositionals: 1,
  },
};

const COMMANDS: Readonly<Record<string, CommandDefinition>> = {
  ...DATABASE_COMMANDS,
  ...APPLICATION_COMMANDS,
};

export interface ParsedCommand {
  readonly command: string;
  readonly config: string;
  readonly project?: string;
  readonly json: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly positionals: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
}

export type ParseCommandResult =
  | { readonly parsed: ParsedCommand }
  | { readonly error: string; readonly command: string; readonly config: string; readonly json: boolean };

export function isCommand(command: string): boolean {
  return Object.hasOwn(COMMANDS, command);
}

export function parseCommand(command: string, argv: readonly string[], cwd: string): ParseCommandResult {
  const definition = COMMANDS[command];
  if (definition === undefined) {
    return {
      error: `unknown command "${command}"`,
      command,
      config: attemptedConfig(argv, cwd),
      json: argv.includes('--json'),
    };
  }

  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: parseOptions({ ...COMMON_OPTIONS, ...definition.options }),
      strict: true,
      allowPositionals: true,
      allowNegative: true,
    });
    if (positionals.length > definition.maximumPositionals) {
      return {
        error: `unexpected positional argument "${positionals[definition.maximumPositionals] ?? ''}"`,
        command,
        config: configValue(values, cwd),
        json: values.json === true,
      };
    }
    return {
      parsed: {
        command,
        config: configValue(values, cwd),
        ...(typeof values.project === 'string' ? { project: values.project } : {}),
        json: values.json === true,
        help: values.help === true,
        version: values.version === true,
        positionals,
        values,
      },
    };
  } catch (error) {
    return {
      error: parseError(error),
      command,
      config: attemptedConfig(argv, cwd),
      json: argv.includes('--json'),
    };
  }
}

export function globalHelp(): string {
  const commandRows = Object.entries(COMMANDS)
    .filter(([, definition]) => definition.hidden !== true)
    .map(([name, definition]) => `  ${name.padEnd(10)} ${definition.summary}`);
  return [
    'zmdb — schema and application developer tools.',
    '',
    'Usage:',
    '  zmdb <command> [options]',
    '',
    'Commands:',
    ...commandRows,
    '',
    'Run `zmdb <command> --help` for command-specific options.',
    '',
  ].join('\n');
}

export function commandHelp(command: string): string {
  const definition = COMMANDS[command];
  if (definition === undefined) return globalHelp();
  const options = { ...COMMON_OPTIONS, ...definition.options };
  const optionRows = Object.entries(options).map(([name, option]) => {
    const longName = name === 'history' ? '--no-history' : `--${name}`;
    const short = option.short === undefined ? '' : `-${option.short}, `;
    const value = option.valueName === undefined ? '' : ` <${option.valueName}>`;
    return `  ${`${short}${longName}${value}`.padEnd(30)} ${option.description}`;
  });
  return [definition.summary, '', 'Usage:', `  ${definition.usage}`, '', 'Options:', ...optionRows, ''].join('\n');
}

function parseOptions(definitions: OptionDefinitions): ParseArgsOptionsConfig {
  const options: ParseArgsOptionsConfig = {};
  for (const [name, definition] of Object.entries(definitions)) {
    options[name] = {
      type: definition.type,
      ...(definition.short === undefined ? {} : { short: definition.short }),
      ...(definition.default === undefined ? {} : { default: definition.default }),
    };
  }
  return options;
}

function configValue(values: Readonly<Record<string, unknown>>, cwd: string): string {
  return resolve(cwd, typeof values.config === 'string' ? values.config : 'zmdb.config.ts');
}

function attemptedConfig(argv: readonly string[], cwd: string): string {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--config') {
      const value = argv[index + 1];
      if (value !== undefined) return resolve(cwd, value);
    }
    if (argument?.startsWith('--config=')) return resolve(cwd, argument.slice('--config='.length));
  }
  return resolve(cwd, 'zmdb.config.ts');
}

function parseError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const message = error.message.replace(/^Option usage error:\s*/i, '');
  const unknown = /^Unknown option '([^']+)'/.exec(message);
  return unknown === null ? message : `unknown option "${unknown[1] ?? ''}"`;
}
