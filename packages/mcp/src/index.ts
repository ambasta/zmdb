// The complete public surface of @zmdb/mcp.
export { MCP_PROTOCOL_VERSION, createMcpServer, type McpServer, type McpServerOptions } from './server.js';
export {
  McpProtocolError,
  createMcpClient,
  type McpClient,
  type McpClientOptions,
  type RemoteTool,
  type RemoteToolResult,
} from './client.js';
