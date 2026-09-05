// Compile-only contract for the real @zmdb/ai package boundary and the remaining
// integration-package target surfaces frozen by issue #703.

import type {
  lenientParse,
  ParseResult,
  toolFor,
  toolFromSchema,
  ToolOptions,
  ToolProvider,
  ToolSchema,
  ToolSpec,
  ToolSpecFor,
} from '@zmdb/ai';
import type {
  defineTools,
  ChatDriver,
  ChatMessage,
  run,
  RunOptions,
  RunResult,
  ToolCall,
  ToolRegistry,
} from '@zmdb/ai/chat';
import type { toolSchemaForProvider, ToolSpecRefusalError as CompilerToolSpecRefusalError } from '@zmdb/ai/compiler';
import type {
  bindOpenApiTool,
  BoundOpenApiTool,
  generateOpenApiToolsModule,
  OpenApiCallerOptions,
  OpenApiGeneratedTool,
  OpenApiHttpError,
  OpenApiOperationIdentity,
  OpenApiToolRequest,
  OpenApiToolsOptions,
  ToolSpecRefusal,
  ToolSpecRefusalError,
  toolsFromOpenApi,
} from '@zmdb/ai/http';
import type {
  executeToolAdapter,
  InvocableTool,
  invokeTool,
  serialiseToolResult,
  ToolAdapterOptions,
  ToolInvocation,
} from '@zmdb/ai/tool-runtime';
import type { Equal, Expect } from '@zmdb/schema-core';
import type {
  aiSdkTool,
  AiSdkToolFields,
  AiSdkToolOptions,
  ToolAdapterOptions as AiSdkToolAdapterOptions,
} from '@zmdb/schema-core/llm/ai-sdk';
import type {
  langchainTool,
  LangChainToolFields,
  ToolAdapterOptions as LangChainToolAdapterOptions,
} from '@zmdb/schema-core/llm/langchain';
import type {
  createMcpClient,
  createMcpServer,
  MCP_PROTOCOL_VERSION,
  McpClient,
  McpClientOptions,
  McpProtocolError,
  McpServer,
  McpServerOptions,
  RemoteTool,
  RemoteToolResult,
} from '@zmdb/schema-core/llm/mcp';

import type {
  anthropicDriver,
  AnthropicDriverOptions,
  AnthropicMessagesClient,
} from '../../schema-core/src/llm/chat/drivers/anthropic.js';

type ExportSet<Values extends string, Types extends string> = {
  readonly values: Values;
  readonly types: Types;
};

type AiExports = {
  readonly '.': ExportSet<
    'lenientParse' | 'toolFor' | 'toolFromSchema',
    'ParseResult' | 'ToolOptions' | 'ToolProvider' | 'ToolSchema' | 'ToolSpec' | 'ToolSpecFor'
  >;
  readonly './chat': ExportSet<
    'defineTools' | 'run',
    'ChatDriver' | 'ChatMessage' | 'RunOptions' | 'RunResult' | 'ToolCall' | 'ToolRegistry'
  >;
  readonly './http': ExportSet<
    'OpenApiHttpError' | 'ToolSpecRefusalError' | 'bindOpenApiTool' | 'generateOpenApiToolsModule' | 'toolsFromOpenApi',
    | 'BoundOpenApiTool'
    | 'OpenApiCallerOptions'
    | 'OpenApiGeneratedTool'
    | 'OpenApiOperationIdentity'
    | 'OpenApiToolRequest'
    | 'OpenApiToolsOptions'
    | 'ToolSpecRefusal'
  >;
  readonly './tool-runtime': ExportSet<
    'executeToolAdapter' | 'invokeTool' | 'serialiseToolResult',
    'InvocableTool' | 'ToolAdapterOptions' | 'ToolInvocation'
  >;
  readonly './compiler': ExportSet<'ToolSpecRefusalError' | 'toolSchemaForProvider', 'ToolSpecRefusal'>;
};

type IntegrationExports = {
  readonly '@zmdb/ai-anthropic': ExportSet<'anthropicDriver', 'AnthropicDriverOptions' | 'AnthropicMessagesClient'>;
  readonly '@zmdb/ai-langchain': ExportSet<'langchainTool', 'LangChainToolFields' | 'ToolAdapterOptions'>;
  readonly '@zmdb/ai-vercel': ExportSet<'aiSdkTool', 'AiSdkToolFields' | 'AiSdkToolOptions' | 'ToolAdapterOptions'>;
  readonly '@zmdb/mcp': ExportSet<
    'MCP_PROTOCOL_VERSION' | 'McpProtocolError' | 'createMcpClient' | 'createMcpServer',
    'McpClient' | 'McpClientOptions' | 'McpServer' | 'McpServerOptions' | 'RemoteTool' | 'RemoteToolResult'
  >;
};

type AiRootValues = {
  readonly lenientParse: typeof lenientParse;
  readonly toolFor: typeof toolFor;
  readonly toolFromSchema: typeof toolFromSchema;
};

type AiChatValues = {
  readonly defineTools: typeof defineTools;
  readonly run: typeof run;
};

type AiHttpValues = {
  readonly OpenApiHttpError: typeof OpenApiHttpError;
  readonly ToolSpecRefusalError: typeof ToolSpecRefusalError;
  readonly bindOpenApiTool: typeof bindOpenApiTool;
  readonly generateOpenApiToolsModule: typeof generateOpenApiToolsModule;
  readonly toolsFromOpenApi: typeof toolsFromOpenApi;
};

type AiToolRuntimeValues = {
  readonly executeToolAdapter: typeof executeToolAdapter;
  readonly invokeTool: typeof invokeTool;
  readonly serialiseToolResult: typeof serialiseToolResult;
};

type AiCompilerValues = {
  readonly ToolSpecRefusalError: typeof CompilerToolSpecRefusalError;
  readonly toolSchemaForProvider: typeof toolSchemaForProvider;
};

type AnthropicValues = { readonly anthropicDriver: typeof anthropicDriver };
type LangChainValues = { readonly langchainTool: typeof langchainTool };
type VercelValues = { readonly aiSdkTool: typeof aiSdkTool };
type McpValues = {
  readonly MCP_PROTOCOL_VERSION: typeof MCP_PROTOCOL_VERSION;
  readonly McpProtocolError: typeof McpProtocolError;
  readonly createMcpClient: typeof createMcpClient;
  readonly createMcpServer: typeof createMcpServer;
};

type FinalDependencies = {
  readonly '@zmdb/schema-core': never;
  readonly '@zmdb/ai': '@zmdb/schema-core';
  readonly '@zmdb/ai-anthropic': '@zmdb/ai';
  readonly '@zmdb/ai-langchain': '@zmdb/ai';
  readonly '@zmdb/ai-vercel': '@zmdb/ai';
  readonly '@zmdb/mcp': '@zmdb/ai';
  readonly '@zmdb/aot-validator': '@zmdb/ai' | '@zmdb/schema-core';
};

type FinalPeers = {
  readonly '@zmdb/schema-core': never;
  readonly '@zmdb/ai': never;
  readonly '@zmdb/ai-anthropic': '@anthropic-ai/sdk@0.123.0';
  readonly '@zmdb/ai-langchain': '@langchain/core@^1.2.9';
  readonly '@zmdb/ai-vercel': 'ai@^7.0.83';
  readonly '@zmdb/mcp': never;
  readonly '@zmdb/aot-validator': never;
};

export type _AiSubpathsAreExact = Expect<
  Equal<keyof AiExports, '.' | './chat' | './compiler' | './http' | './tool-runtime'>
>;
export type _AiRootValuesAreExact = Expect<Equal<keyof AiRootValues, 'lenientParse' | 'toolFor' | 'toolFromSchema'>>;
export type _AiRootTypesAreExact = Expect<
  Equal<
    AiExports['.']['types'],
    'ParseResult' | 'ToolOptions' | 'ToolProvider' | 'ToolSchema' | 'ToolSpec' | 'ToolSpecFor'
  >
>;
export type _AiRootDoesNotEagerlyExposeOtherEntries = Expect<
  Equal<
    Extract<
      keyof AiRootValues,
      | 'anthropicDriver'
      | 'createMcpClient'
      | 'createMcpServer'
      | 'defineTools'
      | 'generateOpenApiToolsModule'
      | 'run'
      | 'toolsFromOpenApi'
    >,
    never
  >
>;
export type _ChatValuesAreExact = Expect<Equal<keyof AiChatValues, 'defineTools' | 'run'>>;
export type _HttpValuesAreExact = Expect<
  Equal<
    keyof AiHttpValues,
    'OpenApiHttpError' | 'ToolSpecRefusalError' | 'bindOpenApiTool' | 'generateOpenApiToolsModule' | 'toolsFromOpenApi'
  >
>;
export type _ToolRuntimeValuesAreExact = Expect<
  Equal<keyof AiToolRuntimeValues, 'executeToolAdapter' | 'invokeTool' | 'serialiseToolResult'>
>;
export type _CompilerValuesAreExact = Expect<
  Equal<keyof AiCompilerValues, 'ToolSpecRefusalError' | 'toolSchemaForProvider'>
>;
export type _IntegrationPackagesAreExact = Expect<
  Equal<keyof IntegrationExports, '@zmdb/ai-anthropic' | '@zmdb/ai-langchain' | '@zmdb/ai-vercel' | '@zmdb/mcp'>
>;
export type _AnthropicRootIsExact = Expect<Equal<keyof AnthropicValues, 'anthropicDriver'>>;
export type _LangChainRootIsExact = Expect<Equal<keyof LangChainValues, 'langchainTool'>>;
export type _VercelRootIsExact = Expect<Equal<keyof VercelValues, 'aiSdkTool'>>;
export type _McpRootIsExact = Expect<
  Equal<keyof McpValues, 'MCP_PROTOCOL_VERSION' | 'McpProtocolError' | 'createMcpClient' | 'createMcpServer'>
>;
export type _SchemaCoreHasNoAiDependency = Expect<Equal<FinalDependencies['@zmdb/schema-core'], never>>;
export type _McpDependsOnlyOnAi = Expect<Equal<FinalDependencies['@zmdb/mcp'], '@zmdb/ai'>>;
export type _AotDependsOnSchemaAndAi = Expect<
  Equal<FinalDependencies['@zmdb/aot-validator'], '@zmdb/ai' | '@zmdb/schema-core'>
>;
export type _OnlyIntegrationPackagesOwnSdkPeers = Expect<
  Equal<
    {
      readonly anthropic: FinalPeers['@zmdb/ai-anthropic'];
      readonly langchain: FinalPeers['@zmdb/ai-langchain'];
      readonly vercel: FinalPeers['@zmdb/ai-vercel'];
    },
    {
      readonly anthropic: '@anthropic-ai/sdk@0.123.0';
      readonly langchain: '@langchain/core@^1.2.9';
      readonly vercel: 'ai@^7.0.83';
    }
  >
>;
export type _ProviderNeutralPackagesHaveNoSdkPeer = Expect<
  Equal<FinalPeers['@zmdb/schema-core'] | FinalPeers['@zmdb/ai'] | FinalPeers['@zmdb/mcp'], never>
>;

// Keeping these aliases referenced makes the compile-only contract cover every named public type,
// while preserving their existing behavioral signatures for the later ownership move.
export type _AiRootTypeSignatures = [
  ParseResult<unknown>,
  ToolOptions,
  ToolProvider,
  ToolSchema,
  ToolSpec,
  ToolSpecFor,
];
export type _ChatTypeSignatures = [ChatDriver, ChatMessage, RunOptions, RunResult, ToolCall, ToolRegistry];
export type _HttpTypeSignatures = [
  BoundOpenApiTool<unknown>,
  OpenApiCallerOptions,
  OpenApiGeneratedTool<unknown>,
  OpenApiOperationIdentity,
  OpenApiToolRequest,
  OpenApiToolsOptions,
  ToolSpecRefusal,
];
export type _ToolRuntimeTypeSignatures = [InvocableTool<unknown>, ToolAdapterOptions<unknown>, ToolInvocation];
export type _AnthropicTypeSignatures = [AnthropicDriverOptions, AnthropicMessagesClient];
export type _LangChainTypeSignatures = [LangChainToolFields, LangChainToolAdapterOptions<unknown>];
export type _VercelTypeSignatures = [
  AiSdkToolFields<unknown, unknown>,
  AiSdkToolOptions<unknown, unknown, unknown>,
  AiSdkToolAdapterOptions<unknown>,
];
export type _McpTypeSignatures = [
  McpClient,
  McpClientOptions,
  McpServer,
  McpServerOptions,
  RemoteTool,
  RemoteToolResult,
];
