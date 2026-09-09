// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

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
