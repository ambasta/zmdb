import { Command, Controller, Get, Module, createApp, createCommandApp } from 'zmdb';

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

const server = createApp(ServerModule);
const commandApp = createCommandApp(ServerModule);

try {
  await server.init();
  const response = await server.fetch(new Request('http://localhost/status'));
  const body = await response.text();

  await commandApp.init();
  const commandExit = await commandApp.run(['probe']);

  if (response.status !== 200 || body !== '"ready"' || commandExit !== 0 || commandRuns !== 1) {
    throw new Error(
      `installed cohesive journey failed: ${JSON.stringify({
        body,
        commandExit,
        commandRuns,
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
    }),
  );
} finally {
  await commandApp[Symbol.asyncDispose]();
  await server[Symbol.asyncDispose]();
}
