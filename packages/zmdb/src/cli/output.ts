export interface CliResult<T> {
  readonly ok: boolean;
  readonly command: string;
  readonly config: string;
  readonly result?: T;
  readonly errors?: readonly { readonly message: string; readonly path?: string }[];
}

export interface OutputStreams {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** The only place a non-interactive command decides which stream receives text. */
export class CliOutput {
  readonly #command: string;
  readonly #config: string;
  readonly #json: boolean;
  readonly #streams: OutputStreams;

  constructor(command: string, config: string, json: boolean, streams: OutputStreams) {
    this.#command = command;
    this.#config = config;
    this.#json = json;
    this.#streams = streams;
  }

  withConfig(config: string): CliOutput {
    return new CliOutput(this.#command, config, this.#json, this.#streams);
  }

  help(text: string): number {
    return this.result({ help: text }, text);
  }

  writeStdout(text: string): void {
    this.#streams.stdout(text);
  }

  writeStderr(text: string): void {
    this.#streams.stderr(text);
  }

  result<T>(value: T, human: string, exitCode = 0): number {
    if (this.#json) {
      const body: CliResult<T> = {
        ok: exitCode === 0,
        command: this.#command,
        config: this.#config,
        result: value,
      };
      this.writeStdout(`${JSON.stringify(body)}\n`);
    } else {
      this.writeStdout(human);
    }
    return exitCode;
  }

  failure(message: string, exitCode: 1 | 2, path?: string): number {
    if (this.#json) {
      const body: CliResult<never> = {
        ok: false,
        command: this.#command,
        config: this.#config,
        errors: [{ message, ...(path === undefined ? {} : { path }) }],
      };
      this.writeStdout(`${JSON.stringify(body)}\n`);
    }
    this.writeStderr(`zmdb ${this.#command}: ${message}\n`);
    return exitCode;
  }
}
