// Benchmarks dashboard.
//
// Renders benchmarks/site/{validation,orm,framework}.json — the files
// benchmarks/scripts/bench.mjs normalises out of the three upstream suites — as
// one interactive page inside the docs shell.
//
// Two deliberate choices:
//
//   * The data is embedded in the page, not fetched. The docs site is opened from
//     file:// as often as from a server, and a dashboard that silently shows
//     nothing because of a CORS failure is worse than no dashboard.
//   * The charts are CSS bars, not a charting library. There is no CDN script,
//     nothing to go stale, and the numbers stay legible with JavaScript disabled
//     because every bar is rendered next to the figure it represents.
//
// If a suite's JSON is missing, its panel says so and names the command that
// produces it. It never falls back to zeroes: a zero is a measurement.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PALETTE_HTML, THEME_BOOT, shellJs, topbarHtml } from './shell.mjs';

const SUITE_META = {
  validation: {
    label: 'Validation',
    blurb:
      'zmdb registered as two participants in moltar/typescript-runtime-type-benchmarks and run by the upstream runner, ' +
      'one forked process per library, against the whole field. <code>zmdb</code> is the runtime validator walking a ' +
      'descriptor; <code>zmdb-aot</code> is the same public API with the transformer applied, so the benchmarked code ' +
      'is transformer output rather than a hand-tuned lookalike.',
    command: 'yarn bench:validation',
  },
  orm: {
    label: 'ORM',
    blurb:
      'zmdb added as a participant server in drizzle-team/drizzle-benchmarks and replayed with k6 over the upstream ' +
      '13-route request list, against the same Postgres, the same driver and the same pool geometry as every other ' +
      'participant. Ranked on throughput with the latency columns kept alongside it.',
    command: 'yarn bench:orm',
  },
  framework: {
    label: 'HTTP framework',
    blurb:
      '@zmdb/web against the the-benchmarker/web-frameworks shared contract — <code>GET /</code>, <code>GET /user/:id</code>, ' +
      '<code>POST /user</code> — with every peer built and measured on this same machine, same load generator, same ' +
      'concurrency levels. Each participant passes the contract check before any load is applied.',
    command: 'yarn bench:framework',
  },
};

function read(dir, name) {
  const path = join(dir, `${name}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Provenance is not decoration. Every panel states which upstream commit was
// grafted, what hardware ran it and when, because a benchmark without those is
// an opinion.
function provenanceHtml(data) {
  if (data === null) return '';
  const commit = data.upstreamCommit;
  const short = commit === null || commit === undefined ? null : commit.slice(0, 10);
  const link =
    data.upstream === undefined || short === null
      ? short
      : `<a href="${escapeHtml(data.upstream)}/commit/${escapeHtml(commit)}"><code>${short}</code></a>`;
  const rows = [
    [
      'Upstream suite',
      data.upstream === undefined ? null : `<a href="${escapeHtml(data.upstream)}">${escapeHtml(data.upstream)}</a>`,
    ],
    ['Grafted commit', link],
    ['Measured', data.measuredAt ?? data.generatedAt ?? null],
    ['Peers measured', data.peersMeasuredAt ?? null],
    ['Machine', data.rig ?? data.machine ?? null],
    ['Runtime', data.runtime ?? null],
    ['Database', data.database ?? null],
    ['Dataset', data.dataset ?? null],
    ['Driver', data.driver ?? null],
    ['Load', data.methodology ?? null],
    ['Peer load', data.peerMethodology ?? null],
    ['Contract', data.contractVerdict ?? null],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  return `<details class="prov"><summary>Provenance &amp; methodology</summary><table class="prov-table">${rows
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
    .join('')}</table>${
    data.caveat === null || data.caveat === undefined
      ? ''
      : `<div class="admonition warning"><div class="adm-title">⚠️ Read this before quoting a number</div><p>${escapeHtml(data.caveat)}</p></div>`
  }</details>`;
}

function missingHtml(name) {
  const meta = SUITE_META[name];
  return `<div class="admonition important"><div class="adm-title">❗ Not measured on this build</div>
<p>No <code>benchmarks/site/${name}.json</code>. This page will not invent a number, and a zero would be a claim of its own —
so the ${meta.label.toLowerCase()} panel is empty until someone runs <code>${meta.command}</code> on a machine with the
suite's preconditions in place. See <code>benchmarks/harness/README.md</code>.</p></div>`;
}

function panel(name, data, body) {
  const meta = SUITE_META[name];
  return `<section class="suite" id="suite-${name}">
<h2>${meta.label}</h2>
<p class="note">${meta.blurb}</p>
${provenanceHtml(data)}
${data === null ? missingHtml(name) : body}
</section>`;
}

function validationPanel(data) {
  if (data === null) return panel('validation', null, '');
  const kinds = data.kinds ?? [];
  const notRun = data.notRun ?? [];
  return panel(
    'validation',
    data,
    `<div class="tabs" data-tabs="kind">${kinds
      .map((k, i) => `<button class="tab${i === 0 ? ' active' : ''}" data-kind="${k}">${k}</button>`)
      .join('')}</div>
<p class="note" id="val-legend"></p>
<div id="val-table"></div>
<h3>All four cases at once</h3>
<p class="note">The same numbers without a tab in the way — useful because a library can win one case and lose another,
and the tabbed view makes that easy to miss.</p>
<div id="val-matrix"></div>
${
  notRun.length === 0
    ? ''
    : `<h3>Requested but not measured <span class="count">${notRun.length}</span></h3>
<p class="note">The upstream runner catches a case that fails to build or load and moves on, leaving no row in the results
file. Publishing the difference is the only way to tell "slower than zmdb" apart from "never ran here".</p>
<details class="prov"><summary>${notRun.length} librar${notRun.length === 1 ? 'y' : 'ies'}</summary><table class="prov-table">${notRun
        .map(entry => `<tr><th><code>${escapeHtml(entry.name)}</code></th><td>${escapeHtml(entry.reason)}</td></tr>`)
        .join('')}</table></details>`
}`,
  );
}

function ormPanel(data) {
  if (data === null) return panel('orm', null, '');
  const metrics = data.metrics ?? [];
  const prepared = data.prepared;
  const dnf = data.dnf ?? [];
  return panel(
    'orm',
    data,
    `<div class="tabs" data-tabs="metric">${metrics
      .map((m, i) => `<button class="tab${i === 0 ? ' active' : ''}" data-metric="${m.key}">${m.label}</button>`)
      .join('')}</div>
<p class="note" id="orm-legend"></p>
<div id="orm-table"></div>
<h3>Route coverage</h3>
<p class="note">Throughput is only comparable between participants that answer the same routes. A participant that cannot
express a route is marked missing here rather than being quietly dropped from the replay.</p>
<div id="orm-coverage"></div>
${
  prepared === null || prepared === undefined
    ? ''
    : `<h3>Prepared statements, head to head</h3>
<p class="note">${escapeHtml(prepared.note ?? '')}</p>
<div id="orm-prepared"></div>
<p class="note honest">${escapeHtml(prepared.verdict ?? '')}</p>`
}
${
  dnf.length === 0
    ? ''
    : `<h3>Did not run</h3><table><tr><th>Participant</th><th>Why</th></tr>${dnf
        .map(row => `<tr><td>${escapeHtml(row.target)}</td><td>${escapeHtml(row.reason)}</td></tr>`)
        .join('')}</table>`
}`,
  );
}

function frameworkPanel(data) {
  if (data === null) return panel('framework', null, '');
  const levels = data.levels ?? [];
  const routes = data.routes ?? [];
  const contract = data.contract ?? [];
  const reference = data.upstreamReference;
  return panel(
    'framework',
    data,
    `<div class="controls">
<label>Concurrency<select id="fw-level">${levels
      .map((l, i) => `<option value="${l}"${i === levels.length - 1 ? ' selected' : ''}>${l}</option>`)
      .join('')}</select></label>
<label>Route<select id="fw-route">${routes.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select></label>
<label>Sort by<select id="fw-sort">
<option value="total_requests_per_s">req/s (desc)</option>
<option value="average_latency">avg latency (asc)</option>
<option value="percentile50">p50 (asc)</option>
<option value="percentile90">p90 (asc)</option>
<option value="percentile99">p99 (asc)</option>
</select></label>
<label>Language<select id="fw-language"><option value="">all</option></select></label>
</div>
<p class="note" id="fw-legend"></p>
<div id="fw-table"></div>
${
  contract.length === 0
    ? ''
    : `<h3>Shared contract</h3>
<p class="note">Verified against every participant, ours included, before load is applied. A framework that fails this is
not measured — a fast wrong answer is not a result.</p>
<table><tr><th>Method</th><th>Route</th><th>Status</th><th>Body</th><th>Verified</th></tr>${contract
        .map(
          row =>
            `<tr><td><code>${escapeHtml(row.method)}</code></td><td><code>${escapeHtml(row.route)}</code></td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.body)}</td><td class="${row.pass ? 'yes' : 'no'}">${row.pass ? 'yes' : 'no'}</td></tr>`,
        )
        .join('')}</table>`
}
${
  reference === null || reference === undefined
    ? ''
    : `<h3>Upstream's own published numbers</h3>
<p class="note">${escapeHtml(reference.note ?? '')} Source: <a href="https://github.com/the-benchmarker/web-frameworks">${escapeHtml(reference.source ?? 'the-benchmarker/web-frameworks')}</a>.
Kept in a separate table on purpose: it was measured on different hardware, so ranking it against the same-machine rows
above would be the exact mistake this dashboard is trying not to make.</p>
<div id="fw-reference"></div>`
}`,
  );
}

const DASH_CSS = `
main{max-width:1160px}
.suite{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:22px 0}
.suite h2{border:0;margin:0 0 8px;font-size:22px}
.suite h3{margin:26px 0 6px;font-size:15px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.suite h3 .count{background:#21262d;border-radius:20px;padding:1px 9px;font-size:12px;color:var(--fg);margin-left:6px}
.suitenav{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 4px;position:sticky;top:0;background:var(--bg);padding:10px 0;z-index:5}
.suitenav a{background:#21262d;border:1px solid var(--line);padding:7px 15px;border-radius:8px;color:var(--fg);font-size:14px;font-weight:600}
.suitenav a:hover{border-color:var(--accent);text-decoration:none}
.tabs{display:flex;gap:8px;margin:12px 0 10px;flex-wrap:wrap}
.tab{background:#21262d;border:1px solid var(--line);color:var(--fg);padding:5px 13px;border-radius:6px;cursor:pointer;font:inherit;font-size:13px}
.tab:hover{border-color:var(--accent)}
.tab.active{background:var(--accent);color:#0d1117;border-color:var(--accent);font-weight:600}
.controls{display:flex;gap:16px;flex-wrap:wrap;margin:14px 0 8px}
.controls label{display:flex;flex-direction:column;gap:4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.controls select{background:#0b0f14;border:1px solid var(--line);border-radius:6px;color:var(--fg);padding:6px 9px;font:inherit;font-size:13px}
.controls select:focus{outline:none;border-color:var(--accent)}
.rank{color:var(--muted);text-align:right;width:34px;font-variant-numeric:tabular-nums}
.suite table{font-size:13.5px}
.suite table td,.suite table th{padding:5px 9px}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.margin{color:var(--muted);font-size:12px}
.bar{position:relative;min-width:120px;height:16px;background:#0b0f14;border-radius:4px;overflow:hidden}
.bar>span{display:block;height:100%;background:linear-gradient(90deg,#1f6feb,#58a6ff);border-radius:4px}
tr.mine{background:rgba(88,166,255,.09)}
tr.mine td:first-child,tr.mine td:nth-child(2){font-weight:700}
tr.mine .bar>span{background:linear-gradient(90deg,#238636,#3fb950)}
.dnf{color:var(--muted);font-style:italic}
.prov{margin:10px 0 4px;border:1px solid var(--line);border-radius:8px;background:#12171d}
.prov summary{cursor:pointer;padding:9px 14px;font-size:13px;color:var(--muted);font-weight:600}
.prov summary:hover{color:var(--fg)}
.prov[open] summary{border-bottom:1px solid var(--line)}
.prov-table{margin:0;font-size:13px;border:0}
.prov-table th{width:150px;background:transparent;color:var(--muted);font-weight:500;border:0;border-bottom:1px solid var(--line);vertical-align:top}
.prov-table td{border:0;border-bottom:1px solid var(--line)}
.prov .admonition{margin:12px 14px}
.yes{color:var(--ok);font-weight:600}.no{color:#f85149}
.note{color:var(--muted);font-size:13px;margin:6px 0 12px}
.honest{border-left:3px solid var(--accent);padding-left:12px}
.grid-scroll{overflow-x:auto}
.cov th:first-child,.cov td:first-child{text-align:left;white-space:nowrap}
.cov th,.cov td{text-align:center}
.downloads{color:var(--muted);font-size:13px;margin-top:26px}
`;

const DASH_JS = String.raw`
(function(){
  var D = window.__ZMDB_BENCH__;
  var int = new Intl.NumberFormat('en-US');
  var f2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  var f3 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function bar(value, max){
    var pct = max > 0 ? Math.max(value / max * 100, 0.6) : 0;
    return '<div class="bar"><span style="width:' + pct.toFixed(2) + '%"></span></div>';
  }
  function ratio(value, base){
    if (!base || !value) return '';
    var r = value / base;
    return r >= 1 ? f2.format(r) + '× faster' : f2.format(1 / r) + '× slower';
  }

  // ---- validation ----
  if (D.validation) {
    var kinds = D.validation.kinds, libs = D.validation.libraries;
    function drawValidation(kind){
      var rows = libs.filter(function(l){ return l.ops[kind] !== null; })
                     .sort(function(a,b){ return b.ops[kind] - a.ops[kind]; });
      var dnf = libs.filter(function(l){ return l.ops[kind] === null; });
      var max = rows.length ? rows[0].ops[kind] : 0;
      var mine = rows.filter(function(l){ return l.name === 'zmdb-aot'; })[0]
              || rows.filter(function(l){ return l.isZmdb; })[0];
      var base = mine ? mine.ops[kind] : 0;
      var html = '<div class="grid-scroll"><table><tr><th></th><th>Library</th><th class="num">ops/sec</th>' +
                 '<th class="num">error</th><th>relative</th><th class="num">vs ' + esc(mine ? mine.name : 'fastest') + '</th></tr>';
      rows.forEach(function(l, i){
        html += '<tr class="' + (l.isZmdb ? 'mine' : '') + '"><td class="rank">' + (i+1) + '</td>' +
                '<td><code>' + esc(l.name) + '</code></td>' +
                '<td class="num">' + int.format(Math.round(l.ops[kind])) + '</td>' +
                '<td class="num margin">±' + f2.format(l.margin[kind]) + '%</td>' +
                '<td>' + bar(l.ops[kind], max) + '</td>' +
                '<td class="num margin">' + (l === mine ? '—' : ratio(l.ops[kind], base)) + '</td></tr>';
      });
      dnf.forEach(function(l){
        html += '<tr class="' + (l.isZmdb ? 'mine' : '') + '"><td class="rank">—</td><td><code>' + esc(l.name) +
                '</code></td><td class="num dnf" colspan="4">did not register this case</td></tr>';
      });
      html += '</table></div>';
      document.getElementById('val-table').innerHTML = html;
      document.getElementById('val-legend').textContent =
        rows.length + ' libraries measured on this case' + (dnf.length ? ', ' + dnf.length + ' did not implement it' : '') +
        '. Higher is better; the error column is the runner\u2019s own margin, so differences inside it are noise.';
    }
    var matrix = '<div class="grid-scroll"><table><tr><th>Library</th>' +
      kinds.map(function(k){ return '<th class="num">' + k + '</th>'; }).join('') + '</tr>' +
      libs.map(function(l){
        return '<tr class="' + (l.isZmdb ? 'mine' : '') + '"><td><code>' + esc(l.name) + '</code></td>' +
          kinds.map(function(k){
            return '<td class="num">' + (l.ops[k] === null ? '<span class="dnf">DNF</span>' : int.format(Math.round(l.ops[k]))) + '</td>';
          }).join('') + '</tr>';
      }).join('') + '</table></div>';
    document.getElementById('val-matrix').innerHTML = matrix;
    var kindTabs = document.querySelectorAll('[data-tabs="kind"] .tab');
    kindTabs.forEach(function(tab){
      tab.addEventListener('click', function(){
        kindTabs.forEach(function(t){ t.classList.remove('active'); });
        tab.classList.add('active');
        drawValidation(tab.dataset.kind);
      });
    });
    drawValidation(kinds[0]);
  }

  // ---- orm ----
  if (D.orm) {
    var targets = D.orm.targets, metrics = D.orm.metrics;
    function drawOrm(key){
      var metric = metrics.filter(function(m){ return m.key === key; })[0];
      var higher = metric.better === 'higher';
      var rows = targets.slice().sort(function(a,b){ return higher ? b[key] - a[key] : a[key] - b[key]; });
      var values = rows.map(function(r){ return r[key]; });
      var worst = Math.max.apply(null, values);
      var span = worst - Math.min.apply(null, values);
      // For a lower-is-better metric a raw bar would be longest for the worst
      // participant. Draw the headroom below the worst value instead, so a longer
      // bar always means "better" on every tab.
      var barOf = function(v){ return higher ? { v: v, max: worst } : { v: worst - v + span * 0.08, max: span * 1.08 }; };
      var html = '<div class="grid-scroll"><table><tr><th></th><th>Participant</th><th class="num">' + esc(metric.label) +
                 '</th><th>relative</th><th class="num">req/s</th><th class="num">avg ms</th><th class="num">p90 ms</th>' +
                 '<th class="num">p95 ms</th><th class="num">failed</th></tr>';
      rows.forEach(function(t, i){
        html += '<tr class="' + (t.isZmdb ? 'mine' : '') + '"><td class="rank">' + (i+1) + '</td>' +
                '<td>' + esc(t.target) + '</td>' +
                '<td class="num">' + f2.format(t[key]) + '</td>' +
                '<td>' + (function(b){ return bar(b.v, b.max); })(barOf(t[key])) + '</td>' +
                '<td class="num">' + int.format(t.requestsPerSecond) + '</td>' +
                '<td class="num">' + f2.format(t.averageLatency) + '</td>' +
                '<td class="num">' + f2.format(t.p90) + '</td>' +
                '<td class="num">' + f2.format(t.p95) + '</td>' +
                '<td class="num ' + (t.failedRequests === 0 ? 'yes' : 'no') + '">' + int.format(t.failedRequests) + '</td></tr>';
      });
      html += '</table></div>';
      document.getElementById('orm-table').innerHTML = html;
      document.getElementById('orm-legend').textContent =
        (higher ? 'Higher is better. ' : 'Lower is better. ') +
        'Every column is shown on every tab so the ordering cannot hide a metric where the ranking reverses \u2014 it does reverse here.';
    }
    var metricTabs = document.querySelectorAll('[data-tabs="metric"] .tab');
    metricTabs.forEach(function(tab){
      tab.addEventListener('click', function(){
        metricTabs.forEach(function(t){ t.classList.remove('active'); });
        tab.classList.add('active');
        drawOrm(tab.dataset.metric);
      });
    });
    drawOrm(metrics[0].key);

    var cov = D.orm.coverage;
    var covHtml = '<div class="grid-scroll"><table class="cov"><tr><th>Route</th>' +
      cov.participants.map(function(p){ return '<th>' + esc(p) + '</th>'; }).join('') + '</tr>' +
      cov.matrix.map(function(row){
        return '<tr><td><code>' + esc(row.route) + '</code></td>' +
          cov.participants.map(function(p){
            return '<td class="' + (row[p] ? 'yes' : 'no') + '">' + (row[p] ? '✓' : '✗') + '</td>';
          }).join('') + '</tr>';
      }).join('') +
      '<tr><td><b>total</b></td>' + cov.participants.map(function(p){
        return '<td><b>' + cov.supported[p].length + '/' + cov.routes.length + '</b></td>';
      }).join('') + '</tr></table></div>';
    document.getElementById('orm-coverage').innerHTML = covHtml;

    var prepEl = document.getElementById('orm-prepared');
    if (prepEl && D.orm.prepared && D.orm.prepared.rows) {
      prepEl.innerHTML = '<div class="grid-scroll"><table><tr><th>Run</th><th class="num">req/s default</th>' +
        '<th class="num">req/s prepared</th><th class="num">avg default</th><th class="num">avg prepared</th>' +
        '<th class="num">p90 default</th><th class="num">p90 prepared</th><th class="num">p95 default</th>' +
        '<th class="num">p95 prepared</th></tr>' +
        D.orm.prepared.rows.map(function(r){
          return '<tr><td class="rank">' + r.run + '</td>' +
            '<td class="num">' + int.format(r['default'].reqs) + '</td><td class="num">' + int.format(r.prepared.reqs) + '</td>' +
            '<td class="num">' + f2.format(r['default'].avg) + '</td><td class="num">' + f2.format(r.prepared.avg) + '</td>' +
            '<td class="num">' + f2.format(r['default'].p90) + '</td><td class="num">' + f2.format(r.prepared.p90) + '</td>' +
            '<td class="num">' + f2.format(r['default'].p95) + '</td><td class="num">' + f2.format(r.prepared.p95) + '</td></tr>';
        }).join('') + '</table></div>';
    }
  }

  // ---- framework ----
  if (D.framework) {
    var rows = D.framework.rows;
    var languages = [];
    rows.forEach(function(r){ if (languages.indexOf(r.language) < 0) languages.push(r.language); });
    languages.sort();
    var langSel = document.getElementById('fw-language');
    languages.forEach(function(l){
      var o = document.createElement('option'); o.value = l; o.textContent = l; langSel.appendChild(o);
    });

    var LOWER_IS_BETTER = { average_latency: 1, percentile50: 1, percentile75: 1, percentile90: 1, percentile99: 1 };
    function drawFramework(){
      var level = Number(document.getElementById('fw-level').value);
      var route = document.getElementById('fw-route').value;
      var sort = document.getElementById('fw-sort').value;
      var lang = langSel.value;
      var lower = LOWER_IS_BETTER[sort] === 1;
      var set = rows.filter(function(r){
        return r.level === level && r.route === route && (lang === '' || r.language === lang);
      }).sort(function(a,b){
        var av = a.metrics[sort], bv = b.metrics[sort];
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        return lower ? av - bv : bv - av;
      });
      var maxRps = Math.max.apply(null, set.map(function(r){ return r.metrics.total_requests_per_s || 0; }));
      var mine = set.filter(function(r){ return r.isZmdb; })[0];
      var html = '<div class="grid-scroll"><table><tr><th></th><th>Framework</th><th>Language</th><th>Runtime</th>' +
        '<th class="num">req/s</th><th>relative</th><th class="num">avg ms</th><th class="num">p50 ms</th>' +
        '<th class="num">p90 ms</th><th class="num">p99 ms</th><th class="num">requests</th><th class="num">errors</th></tr>';
      set.forEach(function(r, i){
        var m = r.metrics;
        var ms = function(v){ return v === undefined ? '—' : f3.format(v * 1000); };
        html += '<tr class="' + (r.isZmdb ? 'mine' : '') + '"><td class="rank">' + (i+1) + '</td>' +
          '<td><code>' + esc(r.id) + '</code></td><td>' + esc(r.language) + '</td><td>' + esc(r.runtime) + '</td>' +
          '<td class="num">' + int.format(Math.round(m.total_requests_per_s || 0)) + '</td>' +
          '<td>' + bar(m.total_requests_per_s || 0, maxRps) + '</td>' +
          '<td class="num">' + ms(m.average_latency) + '</td><td class="num">' + ms(m.percentile50) + '</td>' +
          '<td class="num">' + ms(m.percentile90) + '</td><td class="num">' + ms(m.percentile99) + '</td>' +
          '<td class="num">' + int.format(m.total_requests || 0) + '</td>' +
          '<td class="num ' + ((m.http_errors || 0) === 0 ? 'yes' : 'no') + '">' + int.format(m.http_errors || 0) + '</td></tr>';
      });
      html += '</table></div>';
      document.getElementById('fw-table').innerHTML = html;
      document.getElementById('fw-legend').textContent =
        set.length + ' frameworks at ' + level + ' concurrent connections on ' + route +
        (mine ? ', @zmdb/web ranked #' + (set.indexOf(mine) + 1) : ', @zmdb/web not measured at this level') +
        '. Latency columns are milliseconds. Any framework with a non-zero error count did not really serve that load.';
    }
    ['fw-level','fw-route','fw-sort','fw-language'].forEach(function(id){
      document.getElementById(id).addEventListener('change', drawFramework);
    });
    drawFramework();

    var refEl = document.getElementById('fw-reference');
    var ref = D.framework.upstreamReference;
    if (refEl && ref && ref.frameworks) {
      var levels = D.framework.levels;
      refEl.innerHTML = '<div class="grid-scroll"><table><tr><th>Framework</th><th>Language</th>' +
        levels.map(function(l){ return '<th class="num">req/s @' + l + '</th>'; }).join('') + '</tr>' +
        ref.frameworks.map(function(f){
          return '<tr><td><code>' + esc(f.label) + '</code></td><td>' + esc(f.language) + '</td>' +
            levels.map(function(l){
              var cell = f.byLevel && f.byLevel[String(l)];
              return '<td class="num">' + (cell && cell.rps !== undefined ? int.format(Math.round(cell.rps)) : '—') + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</table></div>';
    }
  }
})();
`;

// Landing-page figures, derived from the same normalised files the dashboard
// renders. Hard-coding these is how a landing page ends up quoting a speedup that
// stopped being true three releases ago; every one of these returns null when the
// suite was not measured, and the caller omits the stat rather than guessing.
export function benchmarkHighlights(dashDir) {
  const validation = read(dashDir, 'validation');
  const orm = read(dashDir, 'orm');
  const framework = read(dashDir, 'framework');

  let aotSpeedup = null;
  let validationLibraries = null;
  if (validation !== null) {
    const libs = validation.libraries ?? [];
    validationLibraries = libs.length;
    const runtime = libs.find(l => l.name === 'zmdb');
    const aot = libs.find(l => l.name === 'zmdb-aot');
    if (runtime !== undefined && aot !== undefined) {
      const ratios = (validation.kinds ?? [])
        .map(kind => (runtime.ops[kind] > 0 && aot.ops[kind] > 0 ? aot.ops[kind] / runtime.ops[kind] : null))
        .filter(r => r !== null);
      if (ratios.length > 0) {
        const low = Math.round(Math.min(...ratios));
        const high = Math.round(Math.max(...ratios));
        aotSpeedup = low === high ? `${low}×` : `${low}–${high}×`;
      }
    }
  }

  let ormCoverage = null;
  if (orm !== null && orm.coverage !== undefined) {
    const supported = orm.coverage.supported['zmdb'] ?? [];
    ormCoverage = { covered: supported.length, total: orm.coverage.routes.length };
  }

  let frameworkPeers = null;
  if (framework !== null) {
    frameworkPeers = new Set((framework.rows ?? []).filter(r => !r.isZmdb).map(r => r.id)).size;
  }

  return { aotSpeedup, validationLibraries, ormCoverage, frameworkPeers };
}

export function buildBenchmarksPage({ css, navHtml, dashDir }) {
  const data = {
    validation: read(dashDir, 'validation'),
    orm: read(dashDir, 'orm'),
    framework: read(dashDir, 'framework'),
  };

  const nav = `<div class="suitenav">${Object.entries(SUITE_META)
    .map(([key, meta]) => `<a href="#suite-${key}">${meta.label}</a>`)
    .join('')}</div>`;

  const intro = `<p>zmdb run <b>inside the actual upstream benchmark suites</b>, against the real competitor field, on this
machine. Each suite is a git submodule under <code>benchmarks/upstream/</code>; zmdb is added to it by
<code>benchmarks/scripts/graft.mjs</code> as a participant plus a minimal patch, and never by editing how the suite measures.
Reproduce any panel below with <code>yarn bench</code>.</p>
<div class="admonition note"><div class="adm-title">📝 What these numbers are, and are not</div>
<p>They are indicative of the machine in the provenance block, not an official ranking — every panel names its hardware,
its upstream commit and its load profile so you can weigh it. A capability a library cannot express is reported as
<b>DNF</b> and never summed into a score, and a participant that failed to build or load is <b>listed by name</b> rather
than dropped, because an omission reads as an absence of competition. Where a metric disagrees with the headline ordering
— it does in the ORM panel — both are shown.</p></div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Benchmarks — zmdb docs</title>
<meta name="description" content="zmdb measured inside the upstream moltar validation, drizzle-benchmarks ORM and the-benchmarker/web-frameworks HTTP suites, with full provenance."/>
<script>${THEME_BOOT}</script>
<style>${css}${DASH_CSS}</style></head><body>
${topbarHtml({ base: '../', active: 'benchmarks', withNavToggle: true })}
<div class="layout">
<aside>
<input class="navsearch" type="search" placeholder="Filter these titles…" aria-label="Filter documentation titles" />
<a class="nav-link nav-top active" href="./index.html">Benchmarks</a>
<a class="nav-link nav-top" href="../openapi.json" target="_blank" download="openapi.json">OpenAPI spec</a>
${navHtml(null, '../docs/')}</aside>
<main>
<div class="crumbs"><a href="../index.html">Docs</a> / Reference</div>
<h1>Benchmarks</h1>
${intro}
${nav}
${validationPanel(data.validation)}
${ormPanel(data.orm)}
${frameworkPanel(data.framework)}
<p class="downloads">Raw data:
<a href="./validation.json" download>validation.json</a> ·
<a href="./orm.json" download>orm.json</a> ·
<a href="./framework.json" download>framework.json</a> ·
<a href="./orm-results.json" download>orm-results.json</a> ·
<a href="./framework-results.json" download>framework-results.json</a> ·
<a href="./peers-results.json" download>peers-results.json</a> ·
<a href="./validation-matrix.json" download>validation-matrix.json</a> (standalone harness cross-check)</p>
</main>
<div></div>
</div>
<div class="scrim"></div>
${PALETTE_HTML}
<script>window.__ZMDB_BENCH__=${JSON.stringify(data).replace(/</g, '\\u003c')};</script>
<script>${shellJs('../')}</script>
<script>${DASH_JS}</script>
</body></html>`;
}
