#!/usr/bin/env bash
# Orchestrate the real drizzle-benchmarks k6 replay for all three ORMs in ONE
# process group: start each server, run the actual k6 script against it, collect
# throughput, then shut it down.
#
# WHY THIS RUNS EACH ORM MORE THAN ONCE
#
# This script used to take a single k6 sample per ORM, in a fixed order, with no
# warmup. That cannot support the conclusion it was being used for. The measured
# margin between the leader and the runner-up here is a few percent, and a
# single sample tells you nothing about whether a few percent is a difference or
# a draw — the framework suite in this same repo moved by up to 2.5x between
# repeats of an identical cell, and a 4% claim under that kind of variance is
# not a result. A fixed order makes it worse: whichever ORM runs last absorbs
# whatever thermal and page-cache drift the earlier ones caused.
#
# So: REPEATS full passes, ORMs interleaved within each pass rather than
# repeated back to back, a discarded warmup run per server start, and a median
# per ORM. The spread (max/min) is printed next to every median, because the
# spread is what says whether the gap between two ORMs means anything. If the
# spread is wider than the gap, the honest reading is "tied", and the table
# should say so.
#
# Usage:
#   ./run-k6.sh                 # 3 passes, warmup on
#   REPEATS=5 ./run-k6.sh       # more passes
#   WARMUP=0 ./run-k6.sh        # skip the discarded warmup run
set -u
# shellcheck source=bench-env.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/bench-env.sh"
OUT="$WORK/k6results"
mkdir -p "$OUT"

# A short k6 profile (the upstream ramps to 3000 VUs over ~10min; we use a
# shorter fixed load so it completes in reasonable time — same script/replay).
cat > "$WORK/bench.js" <<'JS'
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

# The warmup profile is deliberately short: it exists to get the server's JIT
# tiered up, its connection pool filled and Postgres' plan cache populated, none
# of which is what we are trying to measure. Its numbers are thrown away.
cat > "$WORK/warmup.js" <<'JS'
import { scenario } from 'k6/execution';
import http from 'k6/http';
import { SharedArray } from 'k6/data';
const data = new SharedArray('requests', () =>
  JSON.parse(open(__ENV.REQ)).filter((it) => !it.startsWith('/search')));
export const options = {
  scenarios: {
    warm: { executor: 'constant-vus', vus: 50, duration: '5s' },
  },
};
export default function () {
  const u = data[scenario.iterationInTest % data.length];
  http.get(`${__ENV.HOST}${u}`);
}
JS

declare -A RATES PS FAILS

sample_one() { # $1=orm  $2=rep — one server lifetime, one discarded warmup, one measured run
  local orm=$1 rep=$2 port=${PORT[$1]}
  local pid
  pid=$(start_server "$orm" "$port" "$WORK/$orm.log") || return 1

  if [ "$WARMUP" = 1 ]; then
    HOST="http://localhost:$port" REQ="$REQ" "$K6" run --quiet "$WORK/warmup.js" \
      >"$WORK/warmup-$orm.log" 2>&1
  fi

  local summary="$OUT/$orm-rep$rep.json"
  HOST="http://localhost:$port" REQ="$REQ" "$K6" run --quiet --summary-trend-stats="$TREND_STATS" --summary-export="$summary" \
    "$WORK/bench.js" >"$WORK/k6-$orm.log" 2>&1

  local line
  line=$(SUMMARY="$summary" node -e '
    const s = require(process.env.SUMMARY);
    const m = s.metrics;
    const rate = Math.round(m.http_reqs?.rate ?? 0);
    const p95 = Math.round((m.http_req_duration?.["p(95)"] ?? 0) * 100) / 100;
    const failed = m.http_req_failed?.passes ?? m.http_req_failed?.fails ?? 0;
    console.log(`${rate} ${p95} ${failed}`);
  ' 2>/dev/null) || line="0 0 0"

  RATES[$orm]="${RATES[$orm]:-} ${line%% *}"
  local rest=${line#* }
  PS[$orm]="${PS[$orm]:-} ${rest%% *}"
  FAILS[$orm]="${FAILS[$orm]:-} ${rest##* }"
  echo "  rep$rep $orm: req/s=${line%% *} p95=${rest%% *} failed=${rest##* }"

  stop_server "$pid"
}

for rep in $(seq 1 "$REPEATS"); do
  echo "### pass $rep of $REPEATS"
  for orm in $ORMS; do sample_one "$orm" "$rep"; done
done

stat() { # median and spread of a whitespace-separated list
  tr ' ' '\n' <<<"$1" | grep -v '^$' | sort -n | awk '
    { a[NR] = $1 }
    END {
      if (NR == 0) { print "0 0"; exit }
      m = (NR % 2) ? a[int((NR + 1) / 2)] : (a[NR/2] + a[NR/2 + 1]) / 2
      printf "%.0f %.2f", m, (a[1] > 0 ? a[NR] / a[1] : 0)
    }'
}

echo
printf '  %-10s %12s %8s %12s %8s %8s\n' orm "req/s med" spread "p95 med" spread failed
for orm in $ORMS; do
  read -r rmed rspread <<<"$(stat "${RATES[$orm]:-}")"
  read -r pmed pspread <<<"$(stat "${PS[$orm]:-}")"
  failed=$(tr ' ' '\n' <<<"${FAILS[$orm]:-}" | grep -v '^$' | awk '{s+=$1} END {print s+0}')
  printf '  %-10s %12s %7sx %12s %7sx %8s\n' "$orm" "$rmed" "$rspread" "$pmed" "$pspread" "$failed"
done

echo
echo "  Read the spread before the ranking: if the leader's margin over the"
echo "  runner-up is smaller than either one's spread, they are tied, not ranked."
echo "DONE"
