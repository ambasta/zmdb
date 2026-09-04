> **Optional integration.** The tool adapter ships at
> `@zmdb/schema-core/llm/langchain` and supports `@langchain/core` `^1.2.9`.
> Retrievers, vector stores and chat-memory backends remain application choices.

## Tools from schema objects

`langchainTool` supplies the fields `DynamicStructuredTool` expects. Its
validator runs before the handler and returns the decoded application value:

```ts
import { langchainTool } from '@zmdb/schema-core/llm/langchain';
import { assert } from '@zmdb/aot-validator/utilities';
import { DynamicStructuredTool } from '@langchain/core/tools';

export const createUserTool = new DynamicStructuredTool(
  langchainTool('create_user', users, {
    description: 'Create a user',
    validate: input => assert<CreateDTO<User>>(input),
    execute: dto => userRepo.create(dto),
  }),
);
```

The adapter passes zmdb's JSON Schema straight through. Do not route it through
`json-schema-to-zod`: that conversion drops `format`, so `date-time` and
`int64` disappear, and turns a `json` column's `{}` into `z.any()`.

The `validate` function belongs in the application file so the AOT transform
can inline it. It is also the place to decode custom wire values before
`execute` receives them. A `json` column is the clearest reason it remains
required: its JSON Schema is `{}` and constrains nothing.

LangChain checks the JSON Schema before it calls `func`. The `validate` arrow
then handles accepted shapes, including constraints hidden behind `{}`, before
your handler runs.

LangChain tool results are text. The adapter passes strings through and
JSON-stringifies other handler results.

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

LangChain adds a large dependency tree, which may be justified when the
application needs its orchestration features. If the requirement is only to call
a model with a schema-constrained tool and validate the result, the
[plain `fetch` example](./llm-http.html) does that without another dependency.

---

See also: [Structured Output](./llm-structured-output.html) · [LLM Chat](./llm-chat.html) · [Full-Text Search](./full-text-search.html)
