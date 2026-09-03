> **ToDo / feature gap.** There is no view layer — no `@Render`, no template
> engine adapter, no `setViewEngine`. A handler can return rendered HTML itself
> with `respond({ body: html, headers: { 'content-type': 'text/html' } })`, so
> this is a missing convenience rather than a wall; what does not exist is any
> integration that resolves a template name, caches compiled templates, or wires
> an engine into the router.

## What zmdb is for

A JSON API. Every route returns `application/json`, and that is a design position rather than an omission — the framework's whole surface (typed handlers, [derived DTOs](./type-derivation.html), [OpenAPI generation](./web-openapi-operations.html), AOT validation of request bodies) is about the contract between a server and a programmatic client.

If your application is server-rendered HTML, a template-first framework will fit better than working around this. If it is an API with a separate frontend — which is the common case — nothing here affects you.

## Serving HTML anyway

Two arrangements work today.

**A separate frontend.** Next.js, SvelteKit, Astro or a static build talking to your zmdb API. The frontend gets its own deployment, its own caching and its own rendering model, and your API stays a JSON API. See [Next.js](./deploy-nextjs.html).

**HTML from your own adapter**, bypassing `app.handle` for the HTML routes:

```ts
import { createServer } from 'node:http';

createServer(async (req, res) => {
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

  const out = await app.handle(toWebRequest(req));
  res.writeHead(out.status, { ...out.headers }).end(out.body);
});
```

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

> [!WARNING]
> `escapeHtml` is correct for **element text and quoted attribute values only**. It
> is not sufficient inside a `<script>` block, inside a `style` attribute, in an
> unquoted attribute, or in a URL position — `href="javascript:…"` survives it
> untouched. For a URL, validate the scheme:
> `if (!/^https?:\/\//.test(url)) throw …`.

If you are interpolating into more than one context, use a template engine rather than hand-rolling escapes. Eta, Nunjucks and Handlebars all escape by default, and none of them need framework support:

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

## What it would take

Three changes, in order: a response body that can carry a non-JSON string, a way for a handler to set `content-type`, and a way to return a rendered template. The first two are the same core changes [streaming](./web-streaming-files.html) needs.

A template engine adapter itself would not be in the framework — [Directive 7](./anti-patterns.html) is zero required runtime dependencies, so the engine would be yours to bring, and the framework's part is a `@Render('post')` decorator plus a render function on the router. That ordering makes this a follow-on to the response-body work rather than an independent feature.

---

See also: [Static Files](./web-static-files.html) · [Streaming Files](./web-streaming-files.html) · [Next.js](./deploy-nextjs.html)
