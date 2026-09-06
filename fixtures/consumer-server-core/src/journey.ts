import {
  Command,
  Controller,
  Get,
  Module,
  createApp,
  createCommandApp,
  createMemoryJobStore,
  createQueue,
  createWorker,
} from 'zmdb';
import type { Clock, JobHandler } from 'zmdb/jobs';

let commandRuns = 0;

@Controller('/status')
class StatusController {
  @Get()
  status(): string {
    return 'ready';
  }
}

@Command({ name: 'probe', description: 'Run the installed core-server probe.' })
class ProbeCommand {
  run(): void {
    commandRuns += 1;
  }
}

@Module({ controllers: [StatusController], commands: [ProbeCommand] })
class ServerModule {}

const clock: Clock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  },
};

type Jobs = {
  readonly deliver: { readonly id: number };
};

const delivered: number[] = [];
const handler: JobHandler<Jobs, 'deliver'> = {
  name: 'deliver',
  validate(raw) {
    if (typeof raw !== 'object' || raw === null || !('id' in raw) || typeof raw.id !== 'number') {
      throw new Error('deliver requires a numeric id');
    }
    return { id: raw.id };
  },
  handle(payload) {
    delivered.push(payload.id);
    return Promise.resolve();
  },
};

const server = createApp(ServerModule);
const commandApp = createCommandApp(ServerModule);
const store = createMemoryJobStore();

try {
  await server.init();
  const response = await server.fetch(new Request('http://localhost/status'));
  const body = await response.text();

  await commandApp.init();
  const commandExit = await commandApp.run(['probe']);

  const queue = createQueue<Jobs>({ store, clock });
  const worker = createWorker<Jobs>({
    handlers: [handler],
    store,
    clock,
    concurrency: 1,
    graceMs: 1_000,
    leaseMs: 60_000,
    onDead: () => undefined,
    onHandlerError: () => undefined,
  });
  await queue.enqueue('deliver', { id: 7 });
  const report = await worker.runOnce();

  if (
    response.status !== 200 ||
    body !== '"ready"' ||
    commandExit !== 0 ||
    commandRuns !== 1 ||
    report.done !== 1 ||
    JSON.stringify(delivered) !== '[7]'
  ) {
    throw new Error(
      `installed cohesive journey failed: ${JSON.stringify({
        body,
        commandExit,
        commandRuns,
        delivered,
        jobDone: report.done,
        status: response.status,
      })}`,
    );
  }

  console.log(
    JSON.stringify({
      commandExit,
      commandRuns,
      httpBody: body,
      httpStatus: response.status,
      jobDone: report.done,
      jobPayloads: delivered,
    }),
  );
} finally {
  await commandApp[Symbol.asyncDispose]();
  await server[Symbol.asyncDispose]();
  store.close();
}
