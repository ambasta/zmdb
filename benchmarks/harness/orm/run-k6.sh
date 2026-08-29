#!/usr/bin/env bash
# Orchestrate the real drizzle-benchmarks k6 run for all three ORMs in ONE
# process group: start each server, run the actual k6 script against it, collect
# throughput, then shut it down. Runs entirely within a single shell invocation.
set -u
cd /tmp/benchwork/ormbench
K6=/tmp/benchwork/k6
REQ=/tmp/benchwork/drizzle-bench/data/requests.json
OUT=/tmp/benchwork/k6results
mkdir -p "$OUT"

# A short k6 profile (the upstream ramps to 3000 VUs over ~10min; we use a
# shorter fixed load so it completes in reasonable time — same script/replay).
cat > /tmp/benchwork/bench.js <<'JS'
import { scenario } from 'k6/execution';
import http from 'k6/http';
import { SharedArray } from 'k6/data';
const data = new SharedArray('requests', () =>
  JSON.parse(open(__ENV.REQ)).filter((it) => !it.startsWith('/search')));
export const options = {
  scenarios: {
    ramp: { executor: 'ramping-vus', startVUs: 0,
      stages: [ { duration: '5s', target: 200 }, { duration: '10s', target: 400 }, { duration: '10s', target: 400 } ] },
  },
};
export default function () {
  const u = data[scenario.iterationInTest % data.length];
  http.get(`${__ENV.HOST}${u}`);
}
JS

run_one() {
  local orm=$1 port=$2
  ORM=$orm PORT=$port node --experimental-strip-types server.ts >/tmp/benchwork/$orm.log 2>&1 &
  local pid=$!
  # wait for readiness
  for i in $(seq 1 20); do
    if curl -s -o /dev/null "http://localhost:$port/customer-by-id?id=1" 2>/dev/null; then break; fi
    sleep 0.5
  done
  echo "### $orm (:$port)"
  HOST="http://localhost:$port" REQ="$REQ" "$K6" run --quiet --summary-export="$OUT/$orm.json" /tmp/benchwork/bench.js >/tmp/benchwork/k6-$orm.log 2>&1
  # extract http_reqs rate + p95 latency + failure count
  node -e '
    const s=require("/tmp/benchwork/k6results/'$orm'.json");
    const m=s.metrics;
    const reqs=m.http_reqs?.count ?? 0, rate=Math.round(m.http_reqs?.rate ?? 0);
    const p95=Math.round((m.http_req_duration?.["p(95)"]??0)*100)/100;
    const failed=m.http_req_failed?.passes ?? m.http_req_failed?.fails ?? 0;
    console.log(`  total_reqs=${reqs} req/s=${rate} p95_ms=${p95} failed=${failed}`);
  ' 2>/dev/null || echo "  (summary parse failed; see k6-$orm.log)"
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  sleep 1
}

run_one drizzle 3000
run_one kysely 3001
run_one zmdb 3002
echo "DONE"
