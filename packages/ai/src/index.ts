// Migration-only forwarding boundary. The complete ownership cutover removes
// this dependency after the provider integrations and MCP move out of
// schema-core together; the reverse forwarding direction would create a cycle.
export { lenientParse, toolFor, toolFromSchema } from '@zmdb/schema-core/llm';
export type { ParseResult, ToolOptions, ToolProvider, ToolSchema, ToolSpec, ToolSpecFor } from '@zmdb/schema-core/llm';
