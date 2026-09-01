#!/usr/bin/env bash
# Rich full-13-route k6 run: captures latency percentiles + throughput +
# failures per ORM, and a per-route-group latency breakdown, to match the
# informativeness of the upstream dashboards.
#
# Repeats, interleaving and warmup are here for the same reason as in run-k6.sh:
# one sample per ORM in a fixed order cannot tell a few-percent lead apart from
# a few-percent drift, and the numbers this script produces are the ones quoted
# in RESULTS.md. See the long note in run-k6.sh.
#
# Percentiles are NOT averaged across passes — averaging percentiles is
# meaningless. Instead each ORM's reported row is the single pass whose
# throughput was the median, so the p50/p90/p95/p99 and the per-route breakdown
# all come from one coherent run. The throughput spread across passes is printed
# alongside, and that spread is the yardstick for whether a gap is real.
#
# Usage:
#   ./run-k6-rich.sh              # 3 passes, warmup on
#   REPEATS=5 ./run-k6-rich.sh
#   WARMUP=0 ./run-k6-rich.sh
set -u
# shellcheck source=bench-env.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/bench-env.sh"
OUT="$WORK/k6rich"
mkdir -p "$OUT"

cat > "$WORK/bench-rich.js" <<'JS'
import { scenario } from 'k6/execution';
import http from 'k6/http';
import { SharedArray } from 'k6/data';
import { Trend } from 'k6/metrics';
const data = new SharedArray('r', () => JSON.parse(open(__ENV.REQ)));

// Per-route-group latency trends. Both details here are load-bearing, and this
// script got both wrong for its whole life, which is why the per-route table it
// printed was empty with no error anywhere:
//
//  1. A Trend must be constructed in INIT context. Building one lazily inside
//     the VU function is silently dropped — no metric, no warning.
//  2. A metric name must be [A-Za-z0-9_]. Route groups like '/customer-by-id'
//     contain '/' and '-', so the name is rejected. Hence `key()`.
//
// The group list also comes from a SharedArray: init context runs once per VU, so
// re-parsing the 14MB replay file to derive it would cost that per VU.
const groups = new SharedArray('g', () => [
  ...new Set(JSON.parse(open(__ENV.REQ)).map((u) => u.split('?')[0])),
]);
function key(group) { return 'lat_' + group.replace(/[^A-Za-z0-9_]/g, '_'); }
const trends = {};
for (let i = 0; i < groups.length; i += 1) {
  const g = groups[i];
  trends[g] = new Trend(key(g), true);
}

export const options = { scenarios: { ramp: { executor: 'ramping-vus', startVUs: 0,
  stages: [ { duration: '5s', target: 200 }, { duration: '10s', target: 400 }, { duration: '10s', target: 400 } ] } } };
export default function () {
  const u = data[scenario.iterationInTest % data.length];
  const res = http.get(`${__ENV.HOST}${u}`);
  const t = trends[u.split('?')[0]];
  if (t) t.add(res.timings.duration);
}
JS

# Discarded: gets the JIT tiered, the pool filled and PG's plan cache populated.
cat > "$WORK/warmup-rich.js" <<'JS'
import { scenario } from 'k6/execution';
import http from 'k6/http';
import { SharedArray } from 'k6/data';
const data = new SharedArray('r', () => JSON.parse(open(__ENV.REQ)));
export const options = { scenarios: { warm: { executor: 'constant-vus', vus: 50, duration: '5s' } } };
export default function () {
  http.get(`${__ENV.HOST}${data[scenario.iterationInTest % data.length]}`);
}
JS

sample_one() { # $1=orm $2=rep
  local orm=$1 rep=$2 port=${PORT[$1]}
  local pid
  pid=$(start_server "$orm" "$port" "$WORK/rich-$orm.log") || return 1
  if [ "$WARMUP" = 1 ]; then
    HOST="http://localhost:$port" REQ="$REQ" "$K6" run --quiet "$WORK/warmup-rich.js" \
      >"$WORK/warmup-rich-$orm.log" 2>&1
  fi
  HOST="http://localhost:$port" REQ="$REQ" "$K6" run --quiet --summary-trend-stats="$TREND_STATS" --summary-export="$OUT/$orm-rep$rep.json" \
    "$WORK/bench-rich.js" >"$WORK/k6rich-$orm.log" 2>&1
  echo "  pass $rep: $orm done"
  stop_server "$pid"
}

for rep in $(seq 1 "$REPEATS"); do
  echo "### pass $rep of $REPEATS"
  for orm in $ORMS; do sample_one "$orm" "$rep"; done
done

# Emit a combined summary the doc can use.
REPEATS="$REPEATS" OUT="$OUT" node -e '
const fs = require("fs");
const dir = process.env.OUT, reps = Number(process.env.REPEATS);
const orms = ["zmdb", "drizzle", "kysely"];

// For each ORM: load every pass, then keep the pass whose throughput is the
// median. Reporting one real pass keeps the percentiles and the per-route
// breakdown mutually consistent, which averaging them would not.
const picked = {};
for (const o of orms) {
  const passes = [];
  for (let r = 1; r <= reps; r += 1) {
    const path = `${dir}/${o}-rep${r}.json`;
    if (!fs.existsSync(path)) continue;
    const m = JSON.parse(fs.readFileSync(path)).metrics;
    passes.push({ rate: m.http_reqs.rate, m });
  }
  if (!passes.length) continue;
  const byRate = passes.slice().sort((a, b) => a.rate - b.rate);
  const rates = byRate.map(p => p.rate);
  picked[o] = {
    m: byRate[(byRate.length - 1) >> 1].m,
    spread: rates[rates.length - 1] / rates[0],
    n: passes.length,
  };
}

const rows = orms.filter(o => picked[o]).map(o => {
  const { m, spread, n } = picked[o];
  const d = m.http_req_duration;
  return {
    o, n, spread: spread.toFixed(2) + "x",
    reqs: Math.round(m.http_reqs.rate), total: m.http_reqs.count,
    avg: +d.avg.toFixed(1), p50: +d.med.toFixed(1), p90: +d["p(90)"].toFixed(1),
    p95: +d["p(95)"].toFixed(1), p99: +(d["p(99)"] || 0).toFixed(1),
    failed: m.http_req_failed ? (m.http_req_failed.passes || 0) : 0,
  };
});

console.log("\nOVERALL  (median pass of n; spread = max/min throughput across passes)");
console.log("orm      req/s  spread   total   avg   p50   p90   p95   p99  failed   n");
for (const r of rows) {
  console.log(
    `${r.o.padEnd(8)} ${String(r.reqs).padStart(5)} ${r.spread.padStart(7)} ${String(r.total).padStart(7)} ` +
    `${String(r.avg).padStart(5)} ${String(r.p50).padStart(5)} ${String(r.p90).padStart(5)} ` +
    `${String(r.p95).padStart(5)} ${String(r.p99).padStart(5)} ${String(r.failed).padStart(6)} ${String(r.n).padStart(3)}`,
  );
}

if (rows.length > 1) {
  const ranked = rows.slice().sort((a, b) => b.reqs - a.reqs);
  const margin = ranked[0].reqs / ranked[1].reqs;
  const worst = Math.max(...rows.map(r => parseFloat(r.spread)));
  console.log(
    `\nleader margin ${((margin - 1) * 100).toFixed(1)}% (${ranked[0].o} over ${ranked[1].o}); ` +
    `worst spread ${((worst - 1) * 100).toFixed(1)}%`,
  );
  console.log(
    margin < worst
      ? "  => margin is INSIDE the run-to-run spread: report these as TIED, not ranked."
      : "  => margin exceeds the run-to-run spread: the ordering is meaningful.",
  );
}

const zm = picked.zmdb && picked.zmdb.m;
if (zm) {
  const keys = Object.keys(zm).filter(k => k.startsWith("lat_")).sort();
  // Say so out loud rather than printing an empty table under a heading, which
  // is what this did while the trends were being silently dropped by k6.
  if (!keys.length) {
    console.log("\nPER-ROUTE: no lat_* metrics in the summary — the per-route trends did not register.");
  } else {
    console.log("\nPER-ROUTE p95 ms (zmdb / drizzle / kysely), from each ORM\x27s median pass");
    const g = m => k => (m && m[k] ? +m[k]["p(95)"].toFixed(1) : "-");
    const dz = picked.drizzle && picked.drizzle.m, ky = picked.kysely && picked.kysely.m;
    for (const k of keys) {
      console.log(
        `${k.slice(4).padEnd(34)} ${String(g(zm)(k)).padStart(8)} ${String(g(dz)(k)).padStart(8)} ${String(g(ky)(k)).padStart(8)}`,
      );
    }
  }
}
'
echo DONE
