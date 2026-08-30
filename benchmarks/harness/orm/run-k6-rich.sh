#!/usr/bin/env bash
# Rich full-13-route k6 run: captures latency percentiles + throughput +
# failures per ORM, and a per-route-group latency breakdown, to match the
# informativeness of the upstream dashboards.
set -u
cd /home/amitprakash/foss/mono/benchmarks/harness/orm
K6=/tmp/benchwork/k6
REQ=/tmp/benchwork/drizzle-bench/data/requests.json
OUT=/tmp/benchwork/k6rich
mkdir -p "$OUT"

cat > /tmp/benchwork/bench-rich.js <<'JS'
import { scenario } from 'k6/execution';
import http from 'k6/http';
import { SharedArray } from 'k6/data';
import { Trend } from 'k6/metrics';
const data = new SharedArray('r', () => JSON.parse(open(__ENV.REQ)));
// Per-route-group latency trends (tag by first path segment).
const trends = {};
function trend(name) { return (trends[name] = trends[name] || new Trend('lat_' + name, true)); }
export const options = { scenarios: { ramp: { executor: 'ramping-vus', startVUs: 0,
  stages: [ { duration: '5s', target: 200 }, { duration: '10s', target: 400 }, { duration: '10s', target: 400 } ] } } };
export default function () {
  const u = data[scenario.iterationInTest % data.length];
  const group = u.split('?')[0];
  const res = http.get(`${__ENV.HOST}${u}`);
  trend(group).add(res.timings.duration);
}
JS

run_one() {
  local orm=$1 port=$2
  ORM=$orm PORT=$port node --experimental-strip-types server.ts >/tmp/benchwork/rich-$orm.log 2>&1 &
  local pid=$!
  for i in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$port/customer-by-id?id=1" 2>/dev/null && break; sleep 0.5; done
  HOST="http://localhost:$port" REQ="$REQ" "$K6" run --quiet --summary-export="$OUT/$orm.json" /tmp/benchwork/bench-rich.js >/tmp/benchwork/k6rich-$orm.log 2>&1
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; sleep 1
}

run_one drizzle 3000
run_one kysely 3001
run_one zmdb 3002

# Emit a combined summary the doc can use.
node -e '
const fs=require("fs");
const orms=["zmdb","drizzle","kysely"];
const rows=orms.map(o=>{const m=JSON.parse(fs.readFileSync("/tmp/benchwork/k6rich/"+o+".json")).metrics;const d=m.http_req_duration;return {o,reqs:Math.round(m.http_reqs.rate),total:m.http_reqs.count,avg:+d.avg.toFixed(1),p50:+(d.med).toFixed(1),p90:+(d["p(90)"]).toFixed(1),p95:+(d["p(95)"]).toFixed(1),p99:+(d["p(99)"]||0).toFixed(1),failed:m.http_req_failed?(m.http_req_failed.passes||0):0};});
console.log("OVERALL");
console.log("orm      req/s   total   avg   p50   p90   p95   p99  failed");
for(const r of rows) console.log(`${r.o.padEnd(8)} ${String(r.reqs).padStart(5)} ${String(r.total).padStart(7)} ${String(r.avg).padStart(5)} ${String(r.p50).padStart(5)} ${String(r.p90).padStart(5)} ${String(r.p95).padStart(5)} ${String(r.p99).padStart(5)} ${String(r.failed).padStart(6)}`);
// per-route p95 for zmdb
const zm=JSON.parse(fs.readFileSync("/tmp/benchwork/k6rich/zmdb.json")).metrics;
console.log("\nPER-ROUTE p95 ms (zmdb / drizzle / kysely)");
const dz=JSON.parse(fs.readFileSync("/tmp/benchwork/k6rich/drizzle.json")).metrics;
const ky=JSON.parse(fs.readFileSync("/tmp/benchwork/k6rich/kysely.json")).metrics;
for(const k of Object.keys(zm).filter(k=>k.startsWith("lat_")).sort()){
  const route=k.slice(4);
  const g=(m)=>m[k]?(+m[k]["p(95)"].toFixed(1)):"-";
  console.log(`${route.padEnd(34)} ${String(g(zm)).padStart(8)} ${String(g(dz)).padStart(8)} ${String(g(ky)).padStart(8)}`);
}
'
echo DONE
