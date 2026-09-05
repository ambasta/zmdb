// Migration-only forwarding boundary; see ../index.ts.
export {
  OpenApiHttpError,
  ToolSpecRefusalError,
  bindOpenApiTool,
  generateOpenApiToolsModule,
  toolsFromOpenApi,
} from '@zmdb/schema-core/llm/http';
export type {
  BoundOpenApiTool,
  OpenApiCallerOptions,
  OpenApiGeneratedTool,
  OpenApiOperationIdentity,
  OpenApiToolRequest,
  OpenApiToolsOptions,
  ToolSpecRefusal,
} from '@zmdb/schema-core/llm/http';
