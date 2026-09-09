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
#   ORMS="zmdb drizzle kysely" ./run-k6-rich.sh  # explicitly refresh competitors
set -euo pipefail
# shellcheck source=bench-env.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/bench-env.sh"
OUT="$WORK/k6rich"
mkdir -p "$OUT"
ACTIVE_SERVER_PID=""
trap 'if [ -n "$ACTIVE_SERVER_PID" ]; then stop_server "$ACTIVE_SERVER_PID"; fi' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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
  start_server "$orm" "$port" "$WORK/rich-$orm-rep$rep.log" >/dev/null || return 1
  pid=$SERVER_PID
  ACTIVE_SERVER_PID=$pid
  printf '%s %s %s\n' "$rep" "$orm" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT/order.txt"
  if [ "$WARMUP" = 1 ]; then
    if ! HOST="http://localhost:$port" REQ="$REQ" "$K6" run --quiet --summary-trend-stats="$TREND_STATS" --summary-export="$OUT/$orm-warmup-rep$rep.json" "$WORK/warmup-rich.js" \
      >"$WORK/warmup-rich-$orm-rep$rep.log" 2>&1; then
      stop_server "$pid"
      ACTIVE_SERVER_PID=""
      return 1
    fi
  fi
  if ! HOST="http://localhost:$port" REQ="$REQ" "$K6" run --quiet --summary-trend-stats="$TREND_STATS" --summary-export="$OUT/$orm-rep$rep.json" \
    "$WORK/bench-rich.js" >"$WORK/k6rich-$orm-rep$rep.log" 2>&1; then
    stop_server "$pid"
    ACTIVE_SERVER_PID=""
    return 1
  fi
  echo "  pass $rep: $orm done"
  stop_server "$pid"
  ACTIVE_SERVER_PID=""
}

read -r -a candidates <<< "$ORMS"
for rep in $(seq 1 "$REPEATS"); do
  echo "### pass $rep of $REPEATS"
  for ((slot = 0; slot < ${#candidates[@]}; slot++)); do
    orm=${candidates[$(((rep - 1 + slot) % ${#candidates[@]}))]}
    sample_one "$orm" "$rep" || exit 1
  done
done

# Emit a combined summary the doc can use.
REPEATS="$REPEATS" OUT="$OUT" ORMS="$ORMS" REQ="$REQ" node -e '
const fs = require("fs");
const dir = process.env.OUT, reps = Number(process.env.REPEATS);
const orms = process.env.ORMS.trim().split(/\s+/);
const routeKeys = [...new Set(JSON.parse(fs.readFileSync(process.env.REQ)).map(path =>
  "lat_" + path.split("?")[0].replace(/[^A-Za-z0-9_]/g, "_")))].sort();
const numeric = (value, label) => {
  if (!Number.isFinite(value)) throw new Error(`missing or invalid metric: ${label}`);
  return value;
};
const samples = {};

// For each ORM: load every pass, then keep the pass whose throughput is the
// median. Reporting one real pass keeps the percentiles and the per-route
// breakdown mutually consistent, which averaging them would not.
const picked = {};
for (const o of orms) {
  const passes = [];
  for (let r = 1; r <= reps; r += 1) {
    const path = `${dir}/${o}-rep${r}.json`;
    const m = JSON.parse(fs.readFileSync(path)).metrics;
    for (const key of ["http_req_duration", ...routeKeys]) {
      for (const field of ["avg", "med", "p(90)", "p(95)", "p(99)"]) {
        numeric(m[key]?.[field], `${o} pass ${r} ${key}.${field}`);
      }
    }
    numeric(m.http_reqs?.count, `${o} pass ${r} request count`);
    numeric(m.http_req_failed?.passes, `${o} pass ${r} HTTP failures`);
    const rate = numeric(m.http_reqs?.rate, `${o} pass ${r} request rate`);
    if (rate <= 0) throw new Error(`${o} pass ${r} has no successful throughput sample`);
    passes.push({ pass: r, rate, m });
  }
  samples[o] = passes.map(({ pass, rate, m }) => ({
    pass, rate, requests: m.http_reqs.count, failed: m.http_req_failed.passes,
    p95: m.http_req_duration["p(95)"], p99: m.http_req_duration["p(99)"],
    routes: Object.fromEntries(routeKeys.map(key => [key.slice(4), {
      p95: m[key]["p(95)"], p99: m[key]["p(99)"],
    }])),
  }));
  const byRate = passes.slice().sort((a, b) => a.rate - b.rate);
  const rates = byRate.map(p => p.rate);
  picked[o] = {
    m: byRate[(byRate.length - 1) >> 1].m,
    spread: rates[rates.length - 1] / rates[0],
    n: passes.length,
  };
}

fs.writeFileSync(`${dir}/passes.json`, JSON.stringify(samples, null, 2) + "\n");

const rows = orms.map(o => {
  const { m, spread, n } = picked[o];
  const d = m.http_req_duration;
  return {
    o, n, spread: spread.toFixed(2) + "x",
    reqs: Math.round(m.http_reqs.rate), total: m.http_reqs.count,
    avg: +d.avg.toFixed(1), p50: +d.med.toFixed(1), p90: +d["p(90)"].toFixed(1),
    p95: +d["p(95)"].toFixed(1), p99: +d["p(99)"].toFixed(1),
    failed: m.http_req_failed.passes,
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

for (const percentile of ["p(95)", "p(99)"]) {
  console.log(`\nPER-ROUTE ${percentile} ms (${orms.join(" / ")}), from each ORM\x27s median pass`);
  for (const key of routeKeys) {
    console.log(
      `${key.slice(4).padEnd(34)} ${orms.map(o => String(+picked[o].m[key][percentile].toFixed(1)).padStart(8)).join(" ")}`,
    );
  }
}

'
echo DONE
