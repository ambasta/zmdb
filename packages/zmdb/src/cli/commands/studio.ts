import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';

import { createStudioApp, type StudioApp, type StudioInput } from '../../studio/index.js';

export interface StudioListenOptions {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly fetch: StudioApp['fetch'];
}

export interface StudioListener extends AsyncDisposable {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly closed: Promise<void>;
}

export interface StudioRuntime {
  createApp(input: StudioInput): StudioApp;
  listen(options: StudioListenOptions): Promise<StudioListener>;
}

export interface RunStudioOptions {
  readonly port?: number;
  readonly runtime?: StudioRuntime;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

const DEFAULT_RUNTIME: StudioRuntime = {
  createApp: createStudioApp,
  listen: listenStudio,
};

/**
 * Start the local viewer and keep it alive until its loopback listener closes.
 *
 * The host is not an option: the literal passed to the runtime is the security
 * boundary, and the concrete listener below uses it without a fallback.
 */
export async function runStudio(input: StudioInput, options: RunStudioOptions = {}): Promise<number> {
  const runtime = options.runtime ?? DEFAULT_RUNTIME;
  const stdout = options.stdout ?? (text => process.stdout.write(text));
  const stderr = options.stderr ?? (text => process.stderr.write(text));
  let app: StudioApp | undefined;
  let listener: StudioListener | undefined;
  let failed = false;

  try {
    app = runtime.createApp(input);
    listener = await runtime.listen({
      host: '127.0.0.1',
      port: options.port ?? 0,
      fetch: request => app?.fetch(request) ?? Promise.resolve(new Response('studio is closed', { status: 503 })),
    });
    stdout(`http://${listener.host}:${String(listener.port)}\n`);
    await listener.closed;
  } catch (error) {
    failed = true;
    stderr(`zmdb studio: ${messageOf(error)}\n`);
  }

  if (listener !== undefined) {
    try {
      await listener[Symbol.asyncDispose]();
    } catch (error) {
      if (!failed) {
        failed = true;
        stderr(`zmdb studio: ${messageOf(error)}\n`);
      }
    }
  }
  if (app !== undefined) {
    try {
      await app[Symbol.asyncDispose]();
    } catch (error) {
      if (!failed) {
        failed = true;
        stderr(`zmdb studio: ${messageOf(error)}\n`);
      }
    }
  }
  return failed ? 1 : 0;
}

/** Bind the Fetch application to one Node HTTP listener on IPv4 loopback. */
export function listenStudio(options: StudioListenOptions): Promise<StudioListener> {
  validatePort(options.port);

  return new Promise<StudioListener>((resolveListener, rejectListener) => {
    const server = createServer((request, response) => {
      if (request.method !== 'GET') {
        request.resume();
      }
      void serve(request.method ?? 'GET', request.url ?? '/', request.headers, response, options).catch(
        (error: unknown) => {
          if (!response.headersSent) {
            response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
            response.end(`zmdb studio: ${messageOf(error)}`);
          } else {
            response.destroy(error instanceof Error ? error : new Error(String(error)));
          }
        },
      );
    });

    const onOpenError = (error: Error): void => {
      rejectListener(error);
    };
    server.once('error', onOpenError);
    server.listen(options.port, options.host, () => {
      server.off('error', onOpenError);
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        server.close();
        rejectListener(new Error('zmdb studio did not receive a TCP listener address'));
        return;
      }

      const closed = new Promise<void>((resolveClosed, rejectClosed) => {
        server.once('close', resolveClosed);
        server.once('error', rejectClosed);
      });
      const closeForSignal = (): void => {
        server.close();
      };
      const removeSignalHandlers = (): void => {
        process.off('SIGINT', closeForSignal);
        process.off('SIGTERM', closeForSignal);
      };
      process.once('SIGINT', closeForSignal);
      process.once('SIGTERM', closeForSignal);
      void closed.then(removeSignalHandlers, removeSignalHandlers);

      let disposePromise: Promise<void> | undefined;
      resolveListener({
        host: options.host,
        port: address.port,
        closed,
        [Symbol.asyncDispose](): Promise<void> {
          disposePromise ??= closeServer(server.listening, () => server.close(), closed, removeSignalHandlers);
          return disposePromise;
        },
      });
    });
  });
}

async function serve(
  method: string,
  path: string,
  incomingHeaders: IncomingHttpHeaders,
  response: ServerResponse,
  options: StudioListenOptions,
): Promise<void> {
  const url = new URL(path, `http://${options.host}:${String(options.port)}`);
  const request = new Request(url, {
    method,
    headers: requestHeaders(incomingHeaders),
  });
  const result = await options.fetch(request);
  const headers: Record<string, string> = {};
  result.headers.forEach((value, name) => {
    headers[name] = value;
  });
  response.writeHead(result.status, headers);
  response.end(new Uint8Array(await result.arrayBuffer()));
}

function requestHeaders(input: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      headers.set(name, value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    }
  }
  return headers;
}

async function closeServer(
  listening: boolean,
  close: () => void,
  closed: Promise<void>,
  removeSignalHandlers: () => void,
): Promise<void> {
  removeSignalHandlers();
  if (listening) {
    close();
  }
  await closed;
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError(`studio port must be an integer from 0 through 65535, received ${String(port)}`);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
