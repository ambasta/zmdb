# SPEC — query complexity, and the limit that runs before execution (frozen, not planned)

> **Not planned.** GraphQL is out of scope for zmdb: the epics and every sub-issue under them are closed as wontfix, and no code in this tree implements this document. It stays frozen as the record of
> what was decided and why — the failure modes it names are the ones anyone building this outside zmdb will meet.

Part of `@zmdb/web`, exported from the `./graphql` subpath. `../SPEC.md` owns the resolver side; this file owns one function and the arithmetic behind it.

This is the only piece of the GraphQL work that is a **security** requirement rather than a capability. A public endpoint without it is a denial-of-service surface that needs no authentication to
attack, and the reason is arithmetic rather than a bug: a client controls the shape of the query, nesting multiplies, and a document that fits in a tweet can ask for millions of rows. §5's worked
example is 250 characters and costs twelve million.

Two properties therefore drive every decision below. The estimate must be an **upper bound** on the work the document can cause — an estimator that can undercount is a limit that can be walked around.
And the check must happen **before execution begins**, because a limit checked while resolving has already paid for what it was meant to prevent.

## 1. The surface, and where the call goes

```ts
export interface FieldCost {
  /** This field's own cost, or a function of its resolved arguments. */
  readonly cost: number | ((args: Readonly<Record<string, unknown>>) => number);
  /** The named type this field returns, or `undefined` for a leaf. */
  readonly returns?: string;
  /** Whether resolving this field yields many values. */
  readonly list: boolean;
}

/** Keyed by type name, then field name. */
export type CostTable = Readonly<Record<string, Readonly<Record<string, FieldCost>>>>;

export interface ComplexityOptions {
  readonly costs: CostTable;
  readonly maxCost: number;
  readonly operationName?: string;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly defaultFieldCost?: number; // 1
  readonly defaultListSize?: number; // 20
  readonly listSizeArguments?: readonly string[]; // ['first', 'last', 'limit']
  readonly introspectionCost?: number; // 100
  readonly maxDepth?: number; // 32
  readonly revealLimit?: boolean; // false
}

export interface CostResult {
  readonly cost: number;
  readonly overLimit: boolean;
  /** The single field that contributed most, for a log line or a development message. */
  readonly costliest?: { readonly path: string; readonly cost: number };
}

export declare function complexityOf(document: DocumentLike, opts: ComplexityOptions): CostResult;
```

**`complexityOf` returns a result and throws nothing for an over-limit document.** The refusal is the caller's, because the caller is the transport, and `../SPEC.md` §6 already settled that nothing in
this package serves `/graphql`. So the call site is the application's controller, in the one position that satisfies the before-execution requirement:

```ts
@Post('/graphql')
async graphql(ctx: Ctx<Record<never, string>, unknown>) {
  const { query, variables, operationName } = assert<GraphqlRequestBody>(ctx.body);
  const document = parse(query); // the app's `graphql`, not ours
  const { cost, overLimit } = complexityOf(document, { costs, maxCost: 1000, variables, operationName });
  if (overLimit) return json(refusal(cost));
  return json(await execute({ schema, document, variableValues: variables, operationName }));
}
```

Three positions were available and two are wrong. A **validation rule** — the idiomatic place — is refused because `ValidationRule` is `(context: ValidationContext) => ASTVisitor`, and
`ValidationContext` is a `graphql` class, so implementing one makes `graphql` a dependency; §6 of `../SPEC.md` gave that up deliberately and this is not worth reversing it for.

An **interceptor on the field chain** is refused for the reason at the top: by the time a field's chain runs, execution has begun. Between `parse` and `execute` is left, it needs nothing from the
engine but the document, and it is three lines the reader can see.

**An application that does not make this call has no limit.** There is no ambient enforcement, and #549's page must say so above the fold.

## 2. The document is read structurally, and that shape is dated vendor data

Costing needs the parsed document, and this package cannot parse. It can _read_ one, because a GraphQL AST is plain data:

```ts
export interface NameLike {
  readonly value: string;
}
export interface ArgumentLike {
  readonly name: NameLike;
  readonly value: ValueLike;
}
export interface ValueLike {
  readonly kind: string;
  readonly value?: unknown; // IntValue: a string. StringValue/BooleanValue/EnumValue: the value.
  readonly name?: NameLike; // Variable: the variable's name.
}
export interface SelectionLike {
  readonly kind: string; // 'Field' | 'FragmentSpread' | 'InlineFragment'
  readonly name?: NameLike;
  readonly alias?: NameLike;
  readonly arguments?: readonly ArgumentLike[];
  readonly typeCondition?: { readonly name: NameLike };
  readonly selectionSet?: SelectionSetLike;
}
export interface SelectionSetLike {
  readonly selections: readonly SelectionLike[];
}
export interface DefinitionLike {
  readonly kind: string; // 'OperationDefinition' | 'FragmentDefinition' | …
  readonly operation?: string; // 'query' | 'mutation' | 'subscription'
  readonly name?: NameLike;
  readonly selectionSet?: SelectionSetLike;
}
export interface DocumentLike {
  readonly definitions: readonly DefinitionLike[];
}
```

`graphql`'s own `DocumentNode` satisfies `DocumentLike` structurally, so the caller passes `parse(query)` with no adapter and no cast. This is the mirror image of `../SPEC.md` §6's injected
`ScalarTypeConstructor`: there the engine's class is constructed by the consumer, here the engine's data is read by us, and in both directions the type is declared locally and satisfied structurally.

Every `kind` string above is **vendor data with a date on it**, exactly as the `Kind.STRING`/`Kind.VARIABLE` strings in `../../../../schema-core/src/sdl/SPEC.md` §8.1 are: the values are from
`graphql`'s `Kind` enum, and they are stable because they are part of a published specification's AST, not because we control them. A `kind` this walk does not recognise is **skipped and charged
`defaultFieldCost`** rather than ignored, so a future selection kind cannot become a free field.

## 3. Where the table comes from, and why not from the SDL

`CostTable` needs three things per field: a cost, the named type the field returns, and whether it is a list. The first is a policy decision; the second and third are facts about the schema, and
getting either wrong is a silent hole — a list field recorded as `list: false` never multiplies, which is the entire attack.

So they are **not hand-written**. They come from the same type argument the SDL came from:

```ts
/** In `@zmdb/schema-core/sdl`: the structural half of the cost table for one emitted type. */
export declare function costsOf<T>(name: string): CostTable;
```

This is a third transform-only function alongside `sdlOf` and `sdlFields`, and therefore a third name on `CALLEES` — recorded in `../../../../schema-core/src/sdl/SPEC.md` §1 and §12, whose "two new
names" this amends.

It reads the same `TypeIR` walk: a field whose node is an `array` is `list: true`, a field whose node is an `object` or a `ref` has that definition's name as `returns`, everything else is a leaf.

It cannot disagree with the emitted SDL because it is the same traversal over the same input, which is the property a hand-written table cannot have.

`costsOf` supplies structure and `defaultFieldCost` for every field. The cost is then refined by two sources, in this order:

| Source                                                   | Contributes                     | Wins over |
| -------------------------------------------------------- | ------------------------------- | --------- |
| `costsOf<T>(name)`                                       | `returns`, `list`, default cost | —         |
| `@Complexity(n)` on a resolver method (`../SPEC.md` §13) | `cost` for that one field       | `costsOf` |
| the `costs` option, merged by the caller                 | `cost` for any field            | both      |

**`returns` and `list` are never overridable.** A merge that let a caller's table replace them would let a typo turn a list field into a leaf, and the failure mode is a limit that silently stops
multiplying — the worst possible shape for a security control, because everything keeps working.

## 4. The algorithm

One recursive walk. `m` is the multiplier entering a selection set: how many times the engine will resolve each field in it.

```
cost(selectionSet, typeName, m, depth):
  if depth > maxDepth: refuse (QUERY_TOO_DEEP)
  total = 0
  for each selection:
    Field:
      if name is '__typename':        total += 0                       # no resolver runs
      else if name starts with '__':  total += m × introspectionCost    # and do not descend (§8)
      else:
        entry = costs[typeName]?.[name] ?? { cost: defaultFieldCost, list: false }
        own   = typeof entry.cost === 'function' ? entry.cost(resolvedArgs) : entry.cost
        total += m × own
        if the field has a selectionSet:
          childM = m × (entry.list ? listSizeOf(arguments) : 1)
          total += cost(field.selectionSet, entry.returns, childM, depth + 1)
    FragmentSpread:
      total += cost(fragmentNamed(name).selectionSet, typeName, m, depth + 1)
    InlineFragment:
      total += cost(selectionSet, typeCondition?.name.value ?? typeName, m, depth + 1)
  return total
```

The whole document's cost is `cost(operation.selectionSet, rootTypeFor(operation.operation), 1, 0)`, where the root type name is `'Query'` or `'Mutation'`. A `subscription` operation is **refused** —
subscriptions are not in the frozen surface at all, and costing one as if it were a query would report the cost of a single delivery for something that delivers indefinitely.

`listSizeOf(arguments)` takes the first argument named in `listSizeArguments` that is present and resolves to a non-negative integer, and `defaultListSize` otherwise. A `Variable` node resolves from
`variables`; a variable with no value present falls back to `defaultListSize` rather than to zero, because a missing variable that priced a list at nothing would be the cheapest possible bypass.

`maxDepth` is not a substitute for the cost model — the epic says depth limiting alone is insufficient and it is right, because breadth multiplies too. It is here for the estimator's **own** safety:
this walk is recursive, so a ten-thousand-deep document would overflow the stack inside the very function that exists to make hostile documents cheap.

Selecting several operations in one document without naming one is refused, because the engine would refuse it too and costing an arbitrary one would price a query nobody is going to run.

A cost **function** that throws is a refusal with `INTERNAL_SERVER_ERROR`, not `BAD_USER_INPUT`: a cost function is the server's code, and telling a client that their arguments broke the server's
arithmetic is both wrong and informative.

## 5. Worked examples

### 5.1 The case the feature exists for

This is `docs-site/content/web-graphql-complexity.md`'s own example with page sizes added — 250 characters, seven fields, and no repetition:

```graphql
query {
  posts(limit: 50) {
    comments(limit: 50) {
      author {
        posts(limit: 50) {
          comments(limit: 50) {
            author {
              name
            }
          }
        }
      }
    }
  }
}
```

Every cost is the default 1, so the whole number comes from the multipliers:

| Field                 | `m` on entry | Own cost (`m × 1`) | `m` for its children |
| --------------------- | ------------ | ------------------ | -------------------- |
| `posts(limit: 50)`    | 1            | 1                  | 50                   |
| `comments(limit: 50)` | 50           | 50                 | 2,500                |
| `author`              | 2,500        | 2,500              | 2,500 (not a list)   |
| `posts(limit: 50)`    | 2,500        | 2,500              | 125,000              |
| `comments(limit: 50)` | 125,000      | 125,000            | 6,250,000            |
| `author`              | 6,250,000    | 6,250,000          | 6,250,000            |
| `name`                | 6,250,000    | 6,250,000          | —                    |

**Total: 12,630,051.** Against a `maxCost` of 1,000 it is refused four orders of magnitude out, which is the point: the number does not need to be accurate to be decisive.

The same document with the arguments removed — which is how the docs page actually writes it — costs **328,821** on `defaultListSize: 20`. A document that asks for no page size is not cheap, and that
is why the default is 20 rather than 1.

### 5.2 Aliases are separate work

```graphql
query {
  a: posts(limit: 50) {
    id
  }
  b: posts(limit: 50) {
    id
  }
}
```

Each alias is its own selection, so the walk counts each: `1 + 50` twice, **102**. Nothing in the algorithm treats aliases specially; counting them once would require deduplicating by field name, and
a client that aliased the same expensive field a hundred times would pay for one. That is the standard bypass, and it is closed by not writing the code that opens it.

### 5.3 A fragment used twice costs twice

```graphql
query {
  posts(limit: 50) {
    ...postFields
    author {
      ...userFields
    }
  }
}
fragment postFields on Post {
  id
  title
}
fragment userFields on User {
  name
}
```

`postFields` is expanded at its spread site with the multiplier in force there, so its two leaves cost `50 + 50`. A fragment is a document-authoring convenience, not a caching mechanism — the engine
resolves the fields once per spread per parent, so pricing it once per definition would undercount by however many times it was spread.

Inline fragments on sibling type conditions are **summed, not maxed**, and the reason matters. Taking the maximum looks more accurate — only one arm of a union matches a given value — but a _list_ of
an interface can contain values matching different arms, so across the list every arm does execute. Summing is therefore the correct upper bound rather than a conservative approximation.

## 6. Introspection

`__typename` costs **zero**: no resolver runs, the engine answers it from the type it already has.

`__schema` and `__type` cost a flat `introspectionCost` each and **their selection sets are not walked**. The walk would be pricing the engine's own schema traversal, which the cost table knows
nothing about, so every number it produced would be invented. A flat charge per introspection root states exactly what it measures: a coarse bound, multiplied by the multiplier in force, so a hundred
aliased `__schema` selections cost a hundred times and the standard aliased-introspection amplification is closed.

Disabling introspection outright is **not** a zmdb control, and §7 says why.

## 7. What refusal looks like, and what it does not say

The transport builds the response; the shape is frozen so that `#549`'s page and every application agree:

```json
{ "data": null, "errors": [{ "message": "query is too complex", "extensions": { "code": "QUERY_TOO_COMPLEX" } }] }
```

**The default message contains neither the cost nor the limit.** A client who learns both can binary-search the cost model: raise the page size until it is refused, and the difference tells them where
the cheap expensive queries are. `revealLimit: true` produces `query cost 12630051 exceeds the maximum of 1000`, which is what you want in development and in a test, and which the frozen default
withholds in production.

The HTTP status stays **200**, per `../SPEC.md` §7's rule that a GraphQL error is not an HTTP status. A `400` is also protocol-legal here — nothing executed, so there is no partial result to protect —
and it is rejected anyway for a practical reason: GraphQL clients read `errors` from the body, and a `4xx` with a GraphQL body is handled inconsistently enough that a refusal would surface to users as
a network error rather than as the message it is.

`QUERY_TOO_DEEP` uses the same shape, and the same silence about the limit.

**Introspection control is the engine's flag, not ours.** `useDisableIntrospection`, or a validation rule, or the schema the engine was built with — all of them sit where the schema does, which is on
the app's side of the boundary `../SPEC.md` §6 drew. What replaces it here is better than a flag: the emitted SDL is a **committed file** (`../../../../schema-core/src/sdl/SPEC.md` §11), so a client
who needs the schema reads it from the repository, and turning introspection off in production costs them nothing.

## 8. What #545 has to assert

1. `costs a nested list query as the product of its page sizes` — §5.1's document, asserting **12630051** exactly. A wrong multiplier changes this number, which is the point of pinning it rather than
   a threshold.
2. `costs the same document without arguments from the default list size` — 328821, so the default cannot be quietly changed to 1.
3. `counts each alias separately` — §5.2, asserting 102, and that removing one alias halves it.
4. `expands a fragment at each spread site` — a fragment spread twice costs twice, and a `FragmentSpread` naming a definition the document does not contain refuses rather than costing zero.
5. `sums inline fragments on sibling type conditions` — the union case, asserting the sum and explicitly not the maximum.
6. `charges introspection a flat cost per root and does not walk it` — a deeply nested `__schema` and a shallow one cost the same, `__typename` costs nothing, and a hundred aliased `__schema`
   selections cost a hundred times one.
7. `treats a list field with no declared cost conservatively` — an undeclared field is `defaultFieldCost` and still multiplies when `costsOf` recorded it as a list; and a `costs` option that tries to
   set `list` or `returns` does not take effect (§3).
8. `resolves a list size argument from a variable, and falls back when it is absent` — the two branches, with the absent case costing `defaultListSize` and **not** zero.
9. `refuses a document deeper than maxDepth without recursing into it` — a 10,000-deep document returns a refusal rather than throwing a `RangeError`.
10. `withholds the cost and the limit by default` — the message matches `query is too complex` exactly and contains no digits; with `revealLimit: true` it contains both numbers.
11. `refuses a subscription operation and an unnamed choice between operations` — two refusals, each naming what was wrong.
12. `the limit is checked before any resolver runs` — the end-to-end one: a spy resolver's call count is zero for an over-limit document, which is the property the whole file exists for.

## Non-goals (rejected)

- **No validation rule, and no plugin.** §1 — `ValidationContext` is a `graphql` class, and a plugin hook has no consumer (`../SPEC.md` §12).
- **No ambient enforcement.** §1 — the transport is the app's, so the call is the app's. Stated as a consequence rather than a convenience, because it is the one way to end up with no limit.
- **No cost measured during execution.** The top of this file — a limit that observes actual work has already paid for it. A per-request query budget is a genuinely useful _second_ control and it
  already exists as a driver wrapper (`docs-site/content/web-graphql-complexity.md`); it is a backstop, not this.
- **No `@cost` directive in the emitted SDL.** §3 — costs are declared with `@Complexity` and a table. A directive written into the SDL that no zmdb code reads is the "schema that lies" failure
  `../SPEC.md`'s non-goals already name, and it would additionally need a `directive @cost` definition in every document.
- **No hand-written `returns` or `list`.** §3 — a list recorded as a leaf is a limit that stops multiplying, and nothing fails.
- **No max-of-inline-fragments.** §5.3 — wrong for a list of an interface, which is the case that matters.
- **No introspection switch.** §7 — the engine's flag, and the committed SDL is the better answer anyway.
- **No automatic `maxCost`.** There is no default limit and none is inferred. A number that zmdb picked would be wrong for every schema, and a default that is wrong in the permissive direction is a
  control that appears to be present.
