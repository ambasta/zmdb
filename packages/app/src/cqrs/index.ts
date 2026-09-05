// @zmdb/app — typed command bus (epic #591, spec ./SPEC.md).
// The mapped caller surface is built once from a complete handler map. Every
// command crosses the same validation, authorisation, transaction, and outcome
// observation boundary.

import type { TransactionContext } from '@zmdb/repository/transactions';

/** A command name mapped to its input and result types. */
export interface CommandMap {
  readonly [command: string]: { readonly input: unknown; readonly result: unknown };
}

/** The caller-facing command object: one method per command name. */
export type CommandBus<M extends CommandMap> = {
  readonly [K in keyof M]: (input: M[K]['input']) => Promise<M[K]['result']>;
};

/** The complete application-owned handler object. */
export type CommandHandlers<M extends CommandMap> = {
  readonly [K in keyof M]: (input: M[K]['input'], ctx: CommandRun) => Promise<M[K]['result']>;
};

/** Context supplied to one command handler. */
export interface CommandRun {
  readonly command: string;
  readonly tx: TransactionContext | undefined;
}

/** Observation emitted after one command settles. */
export type CommandOutcome =
  | { readonly command: string; readonly ok: true; readonly ms: number }
  | { readonly command: string; readonly ok: false; readonly ms: number; readonly error: unknown };

/** The fixed command pipeline. Validation is deliberately total. */
export interface CommandBusOptions<M extends CommandMap> {
  readonly validate: { readonly [K in keyof M]: (raw: unknown) => M[K]['input'] };
  readonly authorise?: <K extends keyof M & string>(command: K, input: M[K]['input']) => Promise<void>;
  readonly onCommand?: (run: CommandOutcome) => void;
  readonly transaction?: (fn: (tx: TransactionContext) => Promise<unknown>) => Promise<unknown>;
}

function callable(record: object, key: string, kind: string): Function {
  const value: unknown = Reflect.get(record, key);
  if (typeof value !== 'function') {
    throw new Error(`@zmdb/app: command "${key}" has no callable ${kind}`);
  }
  return value;
}

function observe(observer: ((run: CommandOutcome) => void) | undefined, outcome: CommandOutcome): void {
  if (observer === undefined) {
    return;
  }
  try {
    observer(outcome);
  } catch {
    // Observation cannot replace either a successful result or the original
    // command failure.
  }
}

function commandMethod<M extends CommandMap>(
  command: string,
  handler: Function,
  validator: Function,
  options: CommandBusOptions<M>,
): (raw: unknown) => Promise<unknown> {
  return async (raw: unknown): Promise<unknown> => {
    const started = options.onCommand === undefined ? undefined : globalThis.performance.now();
    try {
      const input: unknown = Reflect.apply(validator, undefined, [raw]);
      if (options.authorise !== undefined) {
        await Reflect.apply(options.authorise, undefined, [command, input]);
      }

      const invoke = async (tx: TransactionContext | undefined): Promise<unknown> =>
        Reflect.apply(handler, undefined, [input, { command, tx }]);
      const result =
        options.transaction === undefined ? await invoke(undefined) : await options.transaction(tx => invoke(tx));

      if (started !== undefined) {
        observe(options.onCommand, {
          command,
          ok: true,
          ms: globalThis.performance.now() - started,
        });
      }
      return result;
    } catch (error) {
      if (started !== undefined) {
        observe(options.onCommand, {
          command,
          ok: false,
          ms: globalThis.performance.now() - started,
          error,
        });
      }
      throw error;
    }
  };
}

/**
 * Build an app-owned command bus from a complete, compile-time-checked handler
 * map. There is no registry, discovery pass, decorator, or global singleton.
 */
export function createCommandBus<M extends CommandMap>(
  handlers: CommandHandlers<M>,
  options: CommandBusOptions<M>,
): CommandBus<M> {
  // boundary: Object.create(null) supplies the empty runtime carrier. The
  // mapped input types prove the handler and validator key sets are complete,
  // and the loop installs one method for every own command before returning.
  const bus: CommandBus<M> = Object.create(null);
  for (const command of Object.keys(handlers)) {
    const handler = callable(handlers, command, 'handler');
    const validator = callable(options.validate, command, 'validator');
    const installed = Reflect.set(bus, command, commandMethod(command, handler, validator, options));
    if (!installed) {
      throw new Error(`@zmdb/app: could not install command "${command}"`);
    }
  }
  return bus;
}
