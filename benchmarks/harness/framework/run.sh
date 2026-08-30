#!/usr/bin/env bash
# the-benchmarker/web-frameworks runner for @zmdb/web, following the upstream
# methodology as closely as a standalone harness can:
#   - the app listens on :3000 (the contract)
#   - the shared correctness contract is verified FIRST (contract-check.mjs)
#   - load is generated with `oha`, GET / for 15s, keep-alive DISABLED
#     (--disable-keepalive), latency correction (--latency-correction), and a
#     machine-readable JSON report (--json / --output)
#   - concurrency + routes are configurable via CONCURRENCIES and ROUTES
#     (METHOD:/path,...), exactly like upstream's rake config knobs
#   - collected fields: requests/sec + p50/p75/p90/p99 latency (from oha JSON)
#
# Requirements: `oha` (https://github.com/hatoo/oha) and `jq` on PATH; @zmdb/web
# built (this script builds it). Produces results under ./.results/<concurrency>/.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
PORT="${PORT:-3000}"
HOST="http://localhost:${PORT}"
DURATION="${DURATION:-15s}"
CONCURRENCIES="${CONCURRENCIES:-64}"
ROUTES="${ROUTES:-GET:/}"

echo "== building @zmdb/web (Stage-3 decorators lowered by tsup) =="
( cd "$REPO_ROOT" && yarn workspace @zmdb/web build >/dev/null 2>&1 )
# tsup's ESM emit is what we import; its .d.ts step is unrelated here.
if [ ! -f "$REPO_ROOT/packages/web/dist/index.js" ]; then
  echo "build failed: packages/web/dist/index.js missing"; exit 1
fi

echo "== compiling the contract app (esbuild lowers the app's Stage-3 decorators) =="
# The app uses @zmdb/web decorators; Node cannot parse standard decorators yet,
# so bundle+lower to a runnable ESM module. esbuild bundles the built @zmdb/web
# dist alongside.
( cd "$REPO_ROOT" && yarn exec esbuild "$HERE/app.ts" \
    --bundle --format=esm --platform=node --target=node20 \
    --outfile="$HERE/.app.mjs" >/dev/null 2>&1 ) || {
  # Fallback: esbuild via node API if the CLI shim is unavailable under PnP.
  ( cd "$REPO_ROOT" && node -e '
    const esbuild=require("esbuild");
    esbuild.build({ entryPoints:["'"$HERE"'/app.ts"], bundle:true, format:"esm",
      platform:"node", target:"node20", outfile:"'"$HERE"'/.app.mjs" })
      .catch((e)=>{console.error(e);process.exit(1);});
  ' ) || { echo "esbuild compile failed"; exit 1; }
}

echo "== starting the contract app on :$PORT =="
PORT="$PORT" node "$HERE/.app.mjs" &
APP_PID=$!
cleanup() { kill "$APP_PID" 2>/dev/null; wait "$APP_PID" 2>/dev/null; rm -f "$HERE/.app.mjs"; }
trap cleanup EXIT

# wait for readiness
for _ in $(seq 1 40); do
  if curl -s -o /dev/null "$HOST/" 2>/dev/null; then break; fi
  sleep 0.25
done

echo "== verifying the shared contract (RSpec-equivalent) =="
if ! HOST="$HOST" node "$HERE/contract-check.mjs"; then
  echo "ABORT: contract check failed"; exit 1
fi

if ! command -v oha >/dev/null 2>&1; then
  echo
  echo "NOTE: 'oha' is not installed — contract verified but load run skipped."
  echo "      Install oha (https://github.com/hatoo/oha) and re-run to collect req/s + p50/p75/p90/p99."
  exit 0
fi

IFS=',' read -r -a CONC_LIST <<< "$CONCURRENCIES"
IFS=',' read -r -a ROUTE_LIST <<< "$ROUTES"

for CONC in "${CONC_LIST[@]}"; do
  OUTDIR="$HERE/.results/$CONC"
  mkdir -p "$OUTDIR"
  for ROUTE in "${ROUTE_LIST[@]}"; do
    METHOD="${ROUTE%%:*}"
    RPATH="${ROUTE#*:}"
    SAFE="$(echo "${METHOD}_${RPATH}" | tr '/:' '__')"
    JSON="$OUTDIR/${SAFE}.json"
    echo "== oha ${METHOD} ${RPATH} c=${CONC} for ${DURATION} (keep-alive off, latency-corrected) =="
    oha \
      -z "$DURATION" \
      -c "$CONC" \
      -m "$METHOD" \
      --disable-keepalive \
      --latency-correction \
      --no-tui \
      --output-format json \
      "$HOST$RPATH" > "$JSON" 2>/dev/null || { echo "oha run failed for $ROUTE"; continue; }

    # Extract the upstream-collected fields from oha's JSON report: requests/sec,
    # total data received, run duration, and p50/p75/p90/p99 latency (seconds).
    jq -r '
      "  req/s = \(.summary.requestsPerSec | floor)   duration=\(.summary.total)s   totalData=\(.summary.totalData)B\n" +
      "  p50=\(.latencyPercentiles.p50)  p75=\(.latencyPercentiles.p75)  p90=\(.latencyPercentiles.p90)  p99=\(.latencyPercentiles.p99)  (seconds)"
    ' "$JSON" 2>/dev/null || echo "  (raw JSON at $JSON)"
  done
done

echo "DONE — JSON reports under $HERE/.results/<concurrency>/"
