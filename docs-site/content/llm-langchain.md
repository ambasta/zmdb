> **ToDo / feature gap.** There is no LangChain integration. No retriever, no
> vector store, no tool adapter, no memory backend. zmdb has
> [zero runtime dependencies](./why-zmdb.html) and does not depend on LangChain;
> the adapters below are what you write.

## Tools from schema objects

`DynamicStructuredTool` accepts a JSON Schema for its `schema`, and zmdb produces JSON Schema — so there is no conversion:

```ts
import { toJsonSchema } from '@zmdb/schema-core/openapi';
import { assert } from '@zmdb/aot-validator/utilities';
import { DynamicStructuredTool } from '@langchain/core/tools';

export const createUserTool = new DynamicStructuredTool({
  name: 'create_user',
  description: 'Create a user',
  schema: toJsonSchema(users, 'create'),
  func: async input => {
    const dto = assert<CreateDTO<User>>(input); // check again, LangChain's parse is not yours
    const row = await userRepo.create(dto);
    return JSON.stringify(row);
  },
});
```

Do not route it through `json-schema-to-zod` on the way. The conversion drops `format`, so `date-time` and
`int64` stop being described to the model at all, and it turns a `json` column's `{}` into `z.any()` — a
parameter the model may fill with anything, announced to it as such.

The `assert` earns its place either way. LangChain validates against the schema it was given, which describes
the columns; the `assert` validates against the TypeScript type your repository accepts. A `json` column is
the clearest case — its JSON Schema is `{}` and constrains nothing, so the `assert` is the only thing standing
between the model and a row.

`func` must return a string: the result becomes a `ToolMessage`'s content, hence the `JSON.stringify`.

## A retriever over your own tables

The straightforward version needs no vector store at all — Postgres full-text search is often enough, and it is one query:

```ts
import { BaseRetriever } from '@langchain/core/retrievers';
import { Document } from '@langchain/core/documents';

export class DocsRetriever extends BaseRetriever {
  lc_namespace = ['app', 'retrievers'];

  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const rows = await docRepo.findByFullText('body', query);
    return rows.slice(0, 8).map(
      r =>
        new Document({
          pageContent: String(r.body),
          metadata: { id: r.id, title: String(r.title) },
        }),
    );
  }
}
```

`findByFullText(column, term)` takes the column to match against and the term — there is no options object, no limit and no ranking, so slice in your code or drop to the [FTS builder](./full-text-search.html) for `ORDER BY rank`. It returns `readonly Record<string, unknown>[]` rather than typed entities, because a joined FTS row is not the entity shape; hence the `String(...)` at the boundary. The schema needs `ftsTable` declared or the call throws `UnsupportedFeatureError` — never a silently-wrong query.

For vector similarity, declare a `pgvector` column with
`Ext<'vector', 'vector', [dimensions]>`; zmdb installs the extension and emits
the column DDL, while `createIndexDdl` emits its HNSW or IVFFlat index. Typed
distance expressions are not available yet, so the similarity query remains
[raw SQL](./raw-sql.html). See
[Vector Search](./guide-vector-search.html) and
[Database Extensions](./db-extensions.html).

## Chat memory in your database

LangChain's `BaseChatMessageHistory` is three methods, and a [messages table](./llm-chat.html) is the backing store:

```ts
import { BaseListChatMessageHistory } from '@langchain/core/chat_history';
import { mapStoredMessagesToChatMessages, mapChatMessagesToStoredMessages } from '@langchain/core/messages';

const ROLES = ['user', 'assistant', 'tool'] as const; // must match the column's jsonEnum

export class ZmdbChatHistory extends BaseListChatMessageHistory {
  lc_namespace = ['app', 'memory'];

  constructor(private readonly conversationId: number) {
    super();
  }

  async getMessages() {
    const page = await messageRepo.list({
      where: { conversationId: { eq: this.conversationId } },
      orderBy: [
        { column: 'createdAt', dir: 'asc' },
        { column: 'id', dir: 'asc' },
      ],
      page: { limit: 200 },
    });
    return mapStoredMessagesToChatMessages(page.items.map(r => ({ type: r.role, data: { content: r.content } })));
  }

  async addMessage(message: BaseMessage) {
    const [stored] = mapChatMessagesToStoredMessages([message]);
    if (stored === undefined) return;

    const role = ROLES.find(r => r === stored.type);
    if (role === undefined) throw new Error(`unsupported message type ${stored.type}`);

    await messageRepo.create({
      conversationId: this.conversationId,
      role,
      content: String(stored.data.content),
      toolUse: null,
      tokens: null,
    });
  }

  async clear() {
    /* delete by conversationId */
  }
}
```

`role` is the boundary worth care: LangChain's message types are wider than your `jsonEnum`, so `stored.type` is a `string` where the column wants a union. `ROLES.find` narrows it by a runtime check, which is why no `as` appears here — and it turns a shape mismatch into a loud error instead of a row the database rejects later, or worse, accepts. If dropping unknown types is preferable to failing, `return` instead of throwing; the point is that the decision is written down.

## What is worth being careful about

Adopting LangChain adds a large dependency tree to a project whose data layer has none. That is a legitimate trade for the orchestration, and it is worth knowing you are making it. If what you need is "call a model with a schema-constrained tool and validate the result", that is [twenty lines of `fetch`](./llm-http.html) and no dependency.

---

See also: [Structured Output](./llm-structured-output.html) · [LLM Chat](./llm-chat.html) · [Full-Text Search](./full-text-search.html)
