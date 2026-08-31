> **ToDo / feature gap.** There is no MCP support. Nothing implements the Model
> Context Protocol — no server, no transport, no tool registry. `toolFromSchema`
> produces a provider tool definition, not an MCP one, though the two shapes are
> close.

## What MCP would need

An MCP server exposes tools, resources and prompts over JSON-RPC 2.0, usually on stdio or HTTP+SSE. Mapping zmdb onto it is mostly mechanical:

| MCP concept     | zmdb source                                           |
| --------------- | ----------------------------------------------------- |
| tool definition | `toolFromSchema(name, schema)` — near-identical shape |
| tool invocation | a repository method, after `assert`                   |
| resource        | a row or a query result                               |
| resource schema | `toJsonSchema(schema, 'entity')`                      |

The transport and the JSON-RPC framing are what is missing, and neither is derived from your schema — which is why they are not in a schema library.

## Building one over `@zmdb/web`

For the HTTP transport, a controller is enough. This is a real, working shape:

```ts
import { toolFromSchema } from '@zmdb/schema-core/llm';
import { assert } from '@zmdb/aot-validator/utilities';

const TOOLS = {
  list_users: {
    def: { name: 'list_users', description: 'List users', inputSchema: toListSchema(users) },
    run: (input: unknown) => userRepo.list(assert<ListDTO<typeof users>>(input)),
  },
  create_user: {
    def: { ...toolFromSchema('create_user', users, { description: 'Create a user' }) },
    run: (input: unknown) => userRepo.create(assert<CreateDTO<typeof users>>(input)),
  },
} as const;

@Controller('/mcp')
export class McpController {
  @Post('/')
  async rpc(ctx: Ctx<Record<never, string>, unknown>) {
    const req = assert<{ id: number | string; method: string; params?: Record<string, unknown> }>(ctx.body);

    switch (req.method) {
      case 'tools/list':
        return { jsonrpc: '2.0', id: req.id, result: { tools: Object.values(TOOLS).map(t => t.def) } };

      case 'tools/call': {
        const { name, arguments: args } = assert<{ name: string; arguments: unknown }>(req.params);
        const tool = TOOLS[name as keyof typeof TOOLS];
        if (tool === undefined) {
          return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `unknown tool ${name}` } };
        }
        const result = await tool.run(args);
        return { jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } };
      }

      default:
        return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: req.method } };
    }
  }
}
```

Every tool's input schema comes from the schema object and every invocation validates before touching the database. That is the part worth copying.

## Read this before exposing one

**An MCP server is a remote API with a model driving it.** The model chooses which tools to call and with what arguments, based on text it was given — which may include text from an untrusted source. So:

- **Whitelist tools explicitly.** Do not iterate `registeredSchemas()` and expose CRUD over everything. The `TOOLS` object above is a decision per operation, which is the right granularity.
- **No `run_sql` tool.** See [HTTP Proxy](./connect-http-proxy.html) — a tool that executes arbitrary SQL is a remote database console with a language model at the keyboard.
- **Authorise the caller, not the request.** The model's arguments cannot be trusted to say who it is acting for. Scope every query by an identity from the transport's authentication, the way [multi-tenancy](./entity-filters.html) does.
- **Read-only by default.** Expose reads first. Add each write deliberately, and gate the destructive ones.

## stdio transport

For a local MCP server, the framing is newline-delimited JSON on stdin/stdout — no HTTP:

```ts
process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', async chunk => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    if (line.trim() !== '') process.stdout.write(JSON.stringify(await handle(JSON.parse(line))) + '\n');
  }
});
```

Note the buffering: a chunk boundary can land mid-message, and treating each `data` event as one message is a bug that appears only under load.

## What it would take

A `@zmdb/mcp` package: the JSON-RPC framing, both transports, and a `registerTool(name, schema, handler)` helper. The schema-derived part already exists, so this is protocol plumbing — feasible, and not started.

---

See also: [Structured Output](./llm-structured-output.html) · [LLM Strategy](./llm-strategy.html) · [HTTP Proxy](./connect-http-proxy.html)
