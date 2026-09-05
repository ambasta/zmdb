import {
  createMcpClient,
  createMcpServer,
  type McpClient,
  type McpServer,
  type RemoteTool,
  type RemoteToolResult,
} from '@zmdb/mcp';

const registry = {
  echo: {
    spec: { name: 'echo', parameters: { type: 'object', properties: {}, required: [] } },
    validate: (value: unknown): unknown => value,
    handler: (value: unknown) => JSON.stringify(value),
    effectful: false,
  },
} as const;

export const server: McpServer = createMcpServer(registry, {
  serverInfo: { name: 'consumer', version: '1.0.0' },
  identify: () => Promise.resolve({ sub: 'consumer' }),
});

export const client: McpClient = createMcpClient(message => server.handle(message, { kind: 'stdio' }));
export const tools: Promise<readonly RemoteTool[]> = client.listTools();
export const result: Promise<RemoteToolResult> = client.callTool('echo', { value: 'hello' });
