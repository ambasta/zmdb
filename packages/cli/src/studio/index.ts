import { createQueryCompiler, type DialectTarget, type SelectBuilder } from '@zmdb/query-compiler';
import { aggregateSelectFrom, type AggregateSelect } from '@zmdb/query-compiler/aggregations';
import type { Driver } from '@zmdb/repository';
import { isRecord, type CoreSchema } from '@zmdb/schema-core';
import type { ColumnIR } from '@zmdb/schema-core/ir';
import { toJsonSchema } from '@zmdb/schema-core/openapi';
import { resolveRelation, type ResolvedRelation } from '@zmdb/schema-core/relations';
import { Controller, createRouter, Get, respond, type Ctx, type QueryValues, type WebResponse } from '@zmdb/web';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const HTML_HEADERS = Object.freeze({
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});
const PAGE_QUERY_KEYS = new Set(['page', 'pageSize', 'orderBy', 'direction']);

export interface StudioInput {
  readonly schemas: readonly CoreSchema<string>[];
  readonly driver: Driver;
  readonly dialect?: DialectTarget;
}

export interface StudioApp extends AsyncDisposable {
  fetch(request: Request): Promise<Response>;
}

interface StudioTable {
  readonly schema: CoreSchema<string>;
  readonly visibleColumns: readonly ColumnIR[];
}

interface PageOptions {
  readonly page: number;
  readonly pageSize: number;
  readonly offset: number;
  readonly orderBy: ColumnIR;
  readonly orderByParameter: string | undefined;
  readonly direction: 'asc' | 'desc';
}

interface Predicate {
  readonly column: ColumnIR;
  readonly value: unknown;
}

interface PageResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly total: number;
  readonly options: PageOptions;
}

class StudioRequestError extends Error {
  readonly status: 400 | 404;

  constructor(status: 400 | 404, message: string) {
    super(message);
    this.name = 'StudioRequestError';
    this.status = status;
  }
}

class Studio {
  readonly #driver: Driver;
  readonly #dialect: DialectTarget;
  readonly #tables: readonly StudioTable[];
  readonly #tablesByName: ReadonlyMap<string, StudioTable>;

  constructor(input: StudioInput) {
    this.#driver = input.driver;
    const dialect = input.dialect ?? input.driver.dialect;
    if (dialect === undefined) {
      throw new Error('zmdb studio needs a dialect on its input or driver');
    }
    this.#dialect = dialect;

    const byName = new Map<string, StudioTable>();
    const tables: StudioTable[] = [];
    for (const schema of input.schemas) {
      if (byName.has(schema.ir.table)) {
        throw new Error(`zmdb studio received duplicate configured table "${schema.ir.table}"`);
      }
      const visible = new Set(Object.keys(toJsonSchema(schema).properties));
      const table = {
        schema,
        visibleColumns: schema.ir.columns.filter(column => visible.has(column.name)),
      };
      byName.set(schema.ir.table, table);
      tables.push(table);
    }
    this.#tables = tables.toSorted((left, right) => left.schema.ir.table.localeCompare(right.schema.ir.table));
    this.#tablesByName = byName;
  }

  index(query: QueryValues): WebResponse {
    assertQueryKeys(query, new Set());
    const items =
      this.#tables.length === 0
        ? '<p>No tables are configured.</p>'
        : `<ul class="tables">${this.#tables
            .map(
              table =>
                `<li><a href="${escapeHtml(tablePath(table.schema))}">${escapeHtml(table.schema.ir.table)}</a>` +
                `<span>${String(table.visibleColumns.length)} visible columns</span></li>`,
            )
            .join('')}</ul>`;
    return htmlResponse(
      'Declared tables',
      `<h1>Declared tables</h1><p>The index comes only from the config&apos;s schema set.</p>${items}`,
    );
  }

  async tablePage(tableName: string, query: QueryValues): Promise<WebResponse> {
    const table = this.table(tableName);
    const options = pageOptions(table, query);
    const page = await this.page(table, options, []);
    return htmlResponse(
      table.schema.ir.table,
      [
        breadcrumbs([{ href: '/', label: 'tables' }, { label: table.schema.ir.table }]),
        `<h1>${escapeHtml(table.schema.ir.table)}</h1>`,
        `<p>${String(page.total)} rows. Page ${String(options.page)} of ${String(pageCount(page))}.</p>`,
        renderRows(table, page.rows),
        renderPageControls(tablePath(table.schema), page),
      ].join(''),
    );
  }

  async row(tableName: string, token: string, query: QueryValues): Promise<WebResponse> {
    assertQueryKeys(query, new Set());
    const table = this.table(tableName);
    const key = decodeKey(table, token);
    const row = await this.oneRow(table, key);
    if (row === undefined) {
      throw new StudioRequestError(404, `no row matched the declared key for table "${table.schema.ir.table}"`);
    }

    const fields = table.visibleColumns
      .map(column => `<dt>${escapeHtml(column.name)}</dt><dd>${escapeHtml(displayValue(rowValue(row, column)))}</dd>`)
      .join('');
    const relations = !hasBrowsableKey(table)
      ? '<p>Relations are not linked because this table has no browser-safe declared key.</p>'
      : table.schema.ir.relations.length === 0
        ? '<p>No relations are declared.</p>'
        : `<ul>${table.schema.ir.relations
            .map(
              relation =>
                `<li><a href="${escapeHtml(relationPath(table.schema, token, relation.name))}">${escapeHtml(
                  relation.name,
                )}</a> → ${escapeHtml(relation.target)}</li>`,
            )
            .join('')}</ul>`;

    return htmlResponse(
      `${table.schema.ir.table} row`,
      [
        breadcrumbs([
          { href: '/', label: 'tables' },
          { href: tablePath(table.schema), label: table.schema.ir.table },
          { label: 'row' },
        ]),
        `<h1>${escapeHtml(table.schema.ir.table)} row</h1>`,
        `<dl>${fields}</dl>`,
        '<h2>Declared relations</h2>',
        relations,
      ].join(''),
    );
  }

  async relation(tableName: string, token: string, relationName: string, query: QueryValues): Promise<WebResponse> {
    const table = this.table(tableName);
    const key = decodeKey(table, token);
    const parent = await this.oneRow(table, key);
    if (parent === undefined) {
      throw new StudioRequestError(404, `no row matched the declared key for table "${table.schema.ir.table}"`);
    }

    let relation: ResolvedRelation;
    try {
      relation = resolveRelation(table.schema.ir, relationName);
    } catch (error) {
      throw new StudioRequestError(400, messageOf(error));
    }
    const target = this.table(relation.targetTable);
    const predicates = relation.parentKey.map((parentKey, index) => {
      const targetKey = relation.targetKey[index];
      if (targetKey === undefined) {
        throw new StudioRequestError(400, `${table.schema.table}.${relation.name} resolved mismatched key columns`);
      }
      const parentColumn = declaredColumn(table, parentKey);
      return {
        column: declaredColumn(target, targetKey),
        value: rowValue(parent, parentColumn),
      };
    });
    const options = pageOptions(target, query);
    const page = await this.page(target, options, predicates);

    return htmlResponse(
      `${table.schema.ir.table}.${relation.name}`,
      [
        breadcrumbs([
          { href: '/', label: 'tables' },
          { href: tablePath(table.schema), label: table.schema.ir.table },
          { href: rowPath(table.schema, token), label: 'row' },
          { label: relation.name },
        ]),
        `<h1>${escapeHtml(relation.name)}</h1>`,
        `<p>${String(page.total)} related ${escapeHtml(target.schema.ir.table)} rows.</p>`,
        renderRows(target, page.rows),
        renderPageControls(relationPath(table.schema, token, relation.name), page),
      ].join(''),
    );
  }

  private table(name: string): StudioTable {
    const table = this.#tablesByName.get(name);
    if (table === undefined) {
      throw new StudioRequestError(400, `undeclared table "${name}" is not in the configured schema set`);
    }
    return table;
  }

  private async oneRow(table: StudioTable, key: readonly Predicate[]): Promise<Record<string, unknown> | undefined> {
    let query = createQueryCompiler(this.#dialect)
      .selectFrom(table.schema.ir.physicalTable)
      .select(table.schema.ir.columns.map(column => column.physicalName));
    query = applyPredicates(query, key);
    return (await this.#driver.execute(query.limit(1).compile()))[0];
  }

  private async page(table: StudioTable, options: PageOptions, predicates: readonly Predicate[]): Promise<PageResult> {
    const visible = unique(table.visibleColumns.map(column => column.physicalName));
    const selected = visible.length === 0 ? [options.orderBy.physicalName] : visible;
    let query = createQueryCompiler(this.#dialect)
      .selectFrom(table.schema.ir.physicalTable)
      .select(selected)
      .orderBy(options.orderBy.physicalName, options.direction)
      .limit(options.pageSize)
      .offset(options.offset);
    query = applyPredicates(query, predicates);

    let count = aggregateSelectFrom(table.schema.ir.physicalTable, this.#dialect).count('*', 'count');
    count = applyAggregatePredicates(count, predicates);
    const [rows, countRows] = await Promise.all([
      this.#driver.execute(query.compile()),
      this.#driver.execute(count.compile()),
    ]);

    return {
      rows,
      total: countValue(countRows[0]?.['count']),
      options,
    };
  }
}

@Controller()
class StudioController {
  readonly #studio: Studio;

  constructor(studio: Studio) {
    this.#studio = studio;
  }

  @Get('/')
  index(ctx: Ctx<Record<never, string>, unknown, QueryValues>): Promise<WebResponse> {
    return this.answer(() => this.#studio.index(ctx.query));
  }

  @Get('/tables/:table')
  table(ctx: Ctx<{ table: string }, unknown, QueryValues>): Promise<WebResponse> {
    return this.answer(() => this.#studio.tablePage(decodePath(ctx.params.table), ctx.query));
  }

  @Get('/tables/:table/rows/:key')
  row(ctx: Ctx<{ table: string; key: string }, unknown, QueryValues>): Promise<WebResponse> {
    return this.answer(() => this.#studio.row(decodePath(ctx.params.table), ctx.params.key, ctx.query));
  }

  @Get('/tables/:table/rows/:key/relations/:relation')
  relation(ctx: Ctx<{ table: string; key: string; relation: string }, unknown, QueryValues>): Promise<WebResponse> {
    return this.answer(() =>
      this.#studio.relation(decodePath(ctx.params.table), ctx.params.key, decodePath(ctx.params.relation), ctx.query),
    );
  }

  private async answer(action: () => WebResponse | Promise<WebResponse>): Promise<WebResponse> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof StudioRequestError) {
        return htmlResponse(
          error.status === 404 ? 'Not found' : 'Request refused',
          `<h1>${error.status === 404 ? 'Not found' : 'Request refused'}</h1><p>${escapeHtml(error.message)}</p>`,
          error.status,
        );
      }
      return htmlResponse('Studio error', `<h1>Studio error</h1><p>${escapeHtml(messageOf(error))}</p>`, 500);
    }
  }
}

/**
 * Build the dependency-free server-rendered studio application.
 *
 * The router contains GET routes only. The Fetch boundary rejects every other
 * verb before route matching or database access, so adding a handler cannot
 * accidentally turn the studio into a write surface.
 */
export function createStudioApp(input: StudioInput): StudioApp {
  const router = createRouter();
  router.register(new StudioController(new Studio(input)));
  let disposed = false;

  return {
    async fetch(request: Request): Promise<Response> {
      if (disposed) {
        return new Response('studio is closed', {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
      if (request.method !== 'GET') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { allow: 'GET', 'content-type': 'text/plain; charset=utf-8' },
        });
      }

      const url = new URL(request.url);
      const response = await router.handle({
        method: 'GET',
        path: url.pathname,
        headers: Object.fromEntries(request.headers),
        query: queryValues(url.searchParams),
        scheme: url.protocol.slice(0, -1),
      });
      return fetchResponse(response);
    },
    [Symbol.asyncDispose](): Promise<void> {
      disposed = true;
      return Promise.resolve();
    },
  };
}

function applyPredicates(builder: SelectBuilder, predicates: readonly Predicate[]): SelectBuilder {
  let query = builder;
  for (const predicate of predicates) {
    query = query.where(predicate.column.physicalName, '=', predicate.value);
  }
  return query;
}

function applyAggregatePredicates(builder: AggregateSelect, predicates: readonly Predicate[]): AggregateSelect {
  let query = builder;
  for (const predicate of predicates) {
    query = query.where(predicate.column.physicalName, '=', predicate.value);
  }
  return query;
}

function pageOptions(table: StudioTable, query: QueryValues): PageOptions {
  assertQueryKeys(query, PAGE_QUERY_KEYS);
  const page = positiveInteger(queryValue(query, 'page') ?? '1', 'page');
  const requestedPageSize = positiveInteger(queryValue(query, 'pageSize') ?? String(DEFAULT_PAGE_SIZE), 'pageSize');
  const pageSize = Math.min(requestedPageSize, MAX_PAGE_SIZE);
  const namedOrder = queryValue(query, 'orderBy');
  const defaultOrder =
    table.schema.ir.primaryKey.find(name => isVisibleColumn(table, name)) ??
    table.visibleColumns[0]?.name ??
    table.schema.ir.columns[0]?.name;
  if (defaultOrder === undefined) {
    throw new StudioRequestError(400, `table "${table.schema.ir.table}" declares no columns`);
  }
  const orderBy =
    namedOrder === undefined
      ? declaredColumn(table, defaultOrder)
      : (table.visibleColumns.find(column => column.name === namedOrder) ??
        (() => {
          throw new StudioRequestError(400, `undeclared column "${namedOrder}" on table "${table.schema.ir.table}"`);
        })());
  const namedDirection = queryValue(query, 'direction') ?? 'asc';
  if (namedDirection !== 'asc' && namedDirection !== 'desc') {
    throw new StudioRequestError(400, `direction must be "asc" or "desc", received "${namedDirection}"`);
  }
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) {
    throw new StudioRequestError(400, `page ${String(page)} is too large`);
  }
  return {
    page,
    pageSize,
    offset,
    orderBy,
    orderByParameter: isVisibleColumn(table, orderBy.name) ? orderBy.name : undefined,
    direction: namedDirection,
  };
}

function positiveInteger(value: string, name: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new StudioRequestError(400, `${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new StudioRequestError(400, `${name} is too large`);
  }
  return parsed;
}

function assertQueryKeys(query: QueryValues, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(query)) {
    if (!allowed.has(key)) {
      const suffix = key.toLowerCase() === 'sql' ? '; studio never accepts SQL from the browser' : '';
      throw new StudioRequestError(400, `query parameter "${key}" is not accepted${suffix}`);
    }
  }
}

function queryValue(query: QueryValues, name: string): string | undefined {
  const value = query[name];
  if (value === undefined || typeof value === 'string') {
    return value;
  }
  if (value.length !== 1) {
    throw new StudioRequestError(400, `query parameter "${name}" must appear once`);
  }
  return value[0];
}

function queryValues(search: URLSearchParams): QueryValues {
  const values: Record<string, string | readonly string[]> = {};
  for (const key of new Set(search.keys())) {
    const all = search.getAll(key);
    values[key] = all.length === 1 ? (all[0] ?? '') : all;
  }
  return values;
}

function declaredColumn(table: StudioTable, name: string): ColumnIR {
  const column = table.schema.ir.columns.find(candidate => candidate.name === name);
  if (column === undefined) {
    throw new StudioRequestError(400, `undeclared column "${name}" on table "${table.schema.ir.table}"`);
  }
  return column;
}

function decodeKey(table: StudioTable, token: string): readonly Predicate[] {
  if (table.schema.ir.primaryKey.length === 0) {
    throw new StudioRequestError(400, `table "${table.schema.ir.table}" has no declared primary key`);
  }
  if (!hasBrowsableKey(table)) {
    throw new StudioRequestError(400, `table "${table.schema.ir.table}" has no browser-safe declared key`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodePath(token));
  } catch {
    throw new StudioRequestError(400, `row key for table "${table.schema.ir.table}" is malformed`);
  }
  if (!isRecord(parsed)) {
    throw new StudioRequestError(400, `row key for table "${table.schema.ir.table}" must be an object`);
  }
  const allowed = new Set(table.schema.ir.primaryKey);
  for (const name of Object.keys(parsed)) {
    if (!allowed.has(name)) {
      throw new StudioRequestError(400, `row key names undeclared column "${name}"`);
    }
  }
  return table.schema.ir.primaryKey.map(name => {
    if (!Object.hasOwn(parsed, name)) {
      throw new StudioRequestError(400, `row key is missing declared column "${name}"`);
    }
    const column = declaredColumn(table, name);
    return { column, value: parsed[name] };
  });
}

function isVisibleColumn(table: StudioTable, name: string): boolean {
  return table.visibleColumns.some(column => column.name === name);
}

function encodeKey(table: StudioTable, row: Readonly<Record<string, unknown>>): string | undefined {
  if (!hasBrowsableKey(table)) {
    return undefined;
  }
  const key: Record<string, unknown> = {};
  for (const name of table.schema.ir.primaryKey) {
    const column = declaredColumn(table, name);
    const value = rowValue(row, column);
    if (value === undefined) {
      return undefined;
    }
    key[name] = value;
  }
  return encodeURIComponent(
    JSON.stringify(key, (_name, value: unknown) => (typeof value === 'bigint' ? value.toString() : value)),
  );
}

function hasBrowsableKey(table: StudioTable): boolean {
  return (
    table.schema.ir.primaryKey.length > 0 && table.schema.ir.primaryKey.every(name => isVisibleColumn(table, name))
  );
}

function rowValue(row: Readonly<Record<string, unknown>>, column: ColumnIR): unknown {
  return Object.hasOwn(row, column.physicalName) ? row[column.physicalName] : row[column.name];
}

function countValue(value: unknown): number {
  const count = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`studio count query returned ${String(value)}`);
  }
  return count;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function pageCount(page: PageResult): number {
  return Math.max(1, Math.ceil(page.total / page.options.pageSize));
}

function tablePath(schema: CoreSchema<string>): string {
  return `/tables/${encodeURIComponent(schema.ir.table)}`;
}

function rowPath(schema: CoreSchema<string>, token: string): string {
  return `${tablePath(schema)}/rows/${token}`;
}

function relationPath(schema: CoreSchema<string>, token: string, relation: string): string {
  return `${rowPath(schema, token)}/relations/${encodeURIComponent(relation)}`;
}

function renderRows(table: StudioTable, rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return '<p>No rows on this page.</p>';
  }
  const headers = table.visibleColumns.map(column => `<th scope="col">${escapeHtml(column.name)}</th>`).join('');
  const body = rows
    .map(row => {
      const token = encodeKey(table, row);
      const rowLink =
        token === undefined ? '<span>no key</span>' : `<a href="${escapeHtml(rowPath(table.schema, token))}">view</a>`;
      const cells = table.visibleColumns
        .map(column => `<td>${escapeHtml(displayValue(rowValue(row, column)))}</td>`)
        .join('');
      return `<tr><td>${rowLink}</td>${cells}</tr>`;
    })
    .join('');
  return `<div class="scroll"><table><thead><tr><th scope="col">row</th>${headers}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderPageControls(base: string, page: PageResult): string {
  const pages = pageCount(page);
  const previous =
    page.options.page > 1
      ? `<a rel="prev" href="${escapeHtml(pageHref(base, page.options, page.options.page - 1))}">previous</a>`
      : '<span>previous</span>';
  const next =
    page.options.page < pages
      ? `<a rel="next" href="${escapeHtml(pageHref(base, page.options, page.options.page + 1))}">next</a>`
      : '<span>next</span>';
  return `<nav class="pages" aria-label="pagination">${previous}<span>page ${String(
    page.options.page,
  )} / ${String(pages)}</span>${next}</nav>`;
}

function pageHref(base: string, options: PageOptions, page: number): string {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(options.pageSize),
    direction: options.direction,
  });
  if (options.orderByParameter !== undefined) {
    query.set('orderBy', options.orderByParameter);
  }
  return `${base}?${query.toString()}`;
}

function breadcrumbs(items: readonly { readonly href?: string; readonly label: string }[]): string {
  return `<nav class="crumbs" aria-label="breadcrumb">${items
    .map(item =>
      item.href === undefined
        ? `<span>${escapeHtml(item.label)}</span>`
        : `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`,
    )
    .join('<span>/</span>')}</nav>`;
}

function displayValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `[${String(value.byteLength)} bytes]`;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value, (_name, item: unknown) => (typeof item === 'bigint' ? item.toString() : item));
  } catch {
    return String(value);
  }
}

function htmlResponse(title: string, content: string, status = 200): WebResponse {
  return respond({
    status,
    headers: HTML_HEADERS,
    body:
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      `<title>${escapeHtml(title)} · zmdb studio</title>` +
      '<style>' +
      ':root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}' +
      'body{max-width:1100px;margin:0 auto;padding:2rem;line-height:1.5}' +
      'a{color:LinkText}.warning{border:1px solid #b36b00;padding:.75rem 1rem;border-radius:.4rem}' +
      '.tables{padding:0;list-style:none}.tables li{display:flex;gap:1rem;padding:.5rem 0}' +
      '.tables span{opacity:.7}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}' +
      'th,td{border:1px solid GrayText;padding:.45rem;text-align:left;vertical-align:top}' +
      'dl{display:grid;grid-template-columns:minmax(8rem,15rem) 1fr;gap:.5rem}dt{font-weight:700}' +
      '.crumbs,.pages{display:flex;gap:.65rem;align-items:center}.pages{justify-content:space-between;margin-top:1rem}' +
      'code{font-family:ui-monospace,monospace}' +
      '</style></head><body>' +
      '<p class="warning"><strong>Local raw-data viewer.</strong> Apart from columns declared ' +
      '<code>Sensitive</code>, values are shown without masking. Do not point this at a production ' +
      'database expecting automatic redaction.</p>' +
      `<main>${content}</main></body></html>`,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new StudioRequestError(400, `malformed URL component "${value}"`);
  }
}

function fetchResponse(response: WebResponse): Response {
  const headers = new Headers(response.headers);
  return new Response(response.body.value, { status: response.status, headers });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
