> **Declined, with a reason.** There is no view layer — no `@Render`, no template engine adapter, no `setViewEngine` — and there will not be one. A handler returns rendered HTML itself with
> `respond({ body: html, headers: { 'content-type': 'text/html' } })`, which is the supported arrangement rather than a workaround.
>
> The decision and its four reasons are recorded in `packages/web/src/pipeline/SPEC.md` §A8. Everything on this page is current advice, not a holding pattern.

## What zmdb is for

A JSON API. Most routes return `application/json`, and that is a design position rather than an omission — the framework's whole surface (typed handlers, [derived DTOs](./type-derivation.html),
[OpenAPI generation](./web-openapi-operations.html), AOT validation of request bodies) is about the contract between a server and a programmatic client.

If your application is server-rendered HTML, a template-first framework will fit better than working around this. If it is an API with a separate frontend — which is the common case — nothing here
affects you.

## Render HTML from a handler

Call the engine in ordinary application code and return the rendered string:

```ts
import { Eta } from 'eta';
import { respond, type Ctx } from '@zmdb/web';

const eta = new Eta({ views: './views' });

@Get('/posts/:id')
async page(ctx: Ctx<{ id: string }>) {
  const post = await this.posts.findById(Number(ctx.params.id));
  const html = eta.render('post', { post });

  return respond({
    body: html,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'self'",
      'x-content-type-options': 'nosniff',
    },
  });
}
```

That path uses the normal router, adapters, middleware, and streaming response model. A view-engine seam would only move the `eta.render()` call behind an unchecked string name.

## Other arrangements

**A separate frontend.** Next.js, SvelteKit, Astro or a static build talking to your zmdb API. The frontend gets its own deployment, its own caching and its own rendering model, and your API stays a
JSON API. See [Next.js](./deploy-nextjs.html).

**HTML outside the router.** A custom adapter can deliberately bypass `app.handle` when those routes belong to a separate rendering application:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { bodyText } from '@zmdb/web';

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/';

  if (path === '/' || path.startsWith('/pages/')) {
    const html = await renderPage(path);
    res
      .writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'self'",
        'x-content-type-options': 'nosniff',
      })
      .end(html);
    return;
  }

  const out = await app.handle({
    method: req.method ?? 'GET',
    path,
    headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')])),
  });
  res.writeHead(out.status, { ...out.headers }).end(await bodyText(out));
});
```

This custom adapter buffers a streamed response. Use `toNodeHandler` for routes that must preserve streaming and backpressure.

`handle` takes a `WebRequest` — `{ method, path, headers, rawBody?, query? }` — and there is no helper that converts a `node:http` request into one, so the adapter builds it. `path` is the URL with
the query string removed, which this branch already computed. A route that reads a body needs `rawBody` too; [compression](./web-compression.html) and [streaming files](./web-streaming-files.html)
show the same construction.

The application's services are available to `renderPage` — resolve them from the container once at startup:

```ts
const compiled = compileModule(AppModule);
const posts = compiled.container.resolve(POSTS);

async function renderPage(path: string): Promise<string> {
  const { items } = await posts.list({ page: { limit: 20 } });
  return layout(items.map(p => `<li>${escapeHtml(p.title)}</li>`).join(''));
}
```

## Escaping, which is the entire risk

Template engines default to escaping. Hand-written HTML does not, and every interpolated value is a stored-XSS vector until you escape it.

```ts
const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, c => ESCAPES[c] ?? c);
}
```

> [!WARNING] `escapeHtml` is correct for **element text and quoted attribute values only**. It is not sufficient inside a `<script>` block, inside a `style` attribute, in an unquoted attribute, or in
> a URL position — `href="javascript:…"` survives it untouched. For a URL, validate the scheme: `if (!/^https?:\/\//.test(url)) throw …`.

If you are interpolating into more than one context, use a template engine rather than hand-rolling escapes. Eta, Nunjucks and Handlebars all escape by default, and none of them need framework
support:

```ts
import { Eta } from 'eta';
const eta = new Eta({ views: './views' });
const html = eta.render('post', { post });
```

Add a strict `content-security-policy` regardless. It is the control that limits the damage when an escape is missed, and a missed escape is a question of when.

## Static site generation

If the HTML does not change per request, build it. This sidesteps the whole problem and is faster than any rendering path:

```ts
// scripts/build-site.ts
const { items } = await posts.list({ page: { limit: 1000 } });
for (const post of items) {
  await writeFile(`dist/posts/${post.id}.html`, renderPost(post));
}
```

Then serve `dist/` from a CDN. This is what this documentation site does.

## Why this is declined rather than pending

An earlier version of this page said a view layer needed three core changes first. Two of them already exist — `respond()` carries a non-JSON string and sets `content-type` — so the only thing left
was the seam itself, and on inspection the seam does not earn its place. Four reasons, in the order that decided it:

1. **What a `@Render('post')` decorator does is move a string from a function into a response**, which the one-line `respond()` above already does. The convenience is one line deep.
2. **A seam that resolves templates by name introduces a string key with no type behind it.** A renamed template, a misspelled variable and a missing partial all become runtime failures, in a project
   whose entire argument is that those are compile failures. This is the same objection that rejected a two-meaning `zmdb graph` verb and rejected parsing `.proto` files: an indirection through a name
   the compiler cannot check.
3. **Compilation caching, partial resolution and hot reload are the engine's job**, and Eta, Nunjucks and Handlebars all do them better than a seam could.
4. **The real risk is contextual escaping**, and a seam does not improve it by a single character. The warning above is the whole security story either way.

So the framework's position is that an engine is a direct dependency of your application, called in your handler, returning a string. That needs no framework support, which is why there is none.

If you are choosing a stack and server-rendered HTML is the product rather than an edge of it, a template-first framework will fit better than this one. That is not a limitation to work around; it is
the design position in the first section of this page.

---

See also: [Static Files](./web-static-files.html) · [Streaming Files](./web-streaming-files.html) · [Next.js](./deploy-nextjs.html)
