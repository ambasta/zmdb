#!/usr/bin/env bash
# the-benchmarker/web-frameworks runner for @zmdb/web, following the upstream
# methodology as closely as a standalone harness can:
#   - the app listens on :3000 (the contract)
#   - the shared correctness contract is verified FIRST (contract-check.mjs)
#   - load is generated with `oha`, per route for DURATION, keep-alive DISABLED
#     (--disable-keepalive), latency correction (--latency-correction), and a
#     machine-readable JSON report (--output-format json)
#   - concurrency LEVELS + ROUTES are configurable, exactly like upstream
#     (upstream default levels are 64/256/512; routes GET / , GET /user/:id,
#     POST /user)
#   - collected fields mirror upstream data.min.json labels: total_requests_per_s,
#     average_latency, percentile50/75/90/99/99999, total_requests,
#     total_bytes_received, http_errors, standard_deviation, duration_ms
#
# `oha` is auto-downloaded (pinned) into ./.bin if absent and network allows;
# otherwise the contract is still verified and the load run is skipped (never
# faked). `jq` is required to shape the JSON. @zmdb/web is built by this script.
#
# Output: ./framework-results.json (the-benchmarker-shaped, consumed by the
# dashboard) + raw per-route oha JSON under ./.results/<level>/.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
PORT="${PORT:-3000}"
HOST="http://localhost:${PORT}"
DURATION="${DURATION:-15s}"
# Upstream concurrency levels + shared-contract routes.
CONCURRENCIES="${CONCURRENCIES:-64,256,512}"
ROUTES="${ROUTES:-GET:/,GET:/user/42,POST:/user}"
OHA_VERSION="${OHA_VERSION:-v1.16.0}"

# ---- oha acquisition (pinned prebuilt binary; graceful if unavailable) -------
OHA_BIN=""
resolve_oha() {
  if command -v oha >/dev/null 2>&1; then OHA_BIN="$(command -v oha)"; return 0; fi
  local cached="$HERE/.bin/oha"
  if [ -x "$cached" ]; then OHA_BIN="$cached"; return 0; fi
  # Only linux x86_64 prebuilt is auto-fetched; other platforms: install oha.
  local arch os asset
  arch="$(uname -m)"; os="$(uname -s)"
  case "$os/$arch" in
    Linux/x86_64|Linux/amd64) asset="oha-linux-amd64" ;;
    Linux/aarch64|Linux/arm64) asset="oha-linux-arm64" ;;
    *) echo "  (no prebuilt oha for $os/$arch — install oha manually)"; return 1 ;;
  esac
  local url="https://github.com/hatoo/oha/releases/download/${OHA_VERSION}/${asset}"
  echo "== fetching oha ${OHA_VERSION} (${asset}) =="
  mkdir -p "$HERE/.bin"
  if curl -sSL -m 120 -o "$cached" "$url" 2>/dev/null && [ -s "$cached" ]; then
    chmod +x "$cached"
    if "$cached" --version >/dev/null 2>&1; then OHA_BIN="$cached"; return 0; fi
  fi
  rm -f "$cached"; echo "  (oha download failed — will skip load run)"; return 1
}

echo "== building @zmdb/web (Stage-3 decorators lowered by tsup) =="
( cd "$REPO_ROOT" && yarn workspace @zmdb/web build >/dev/null 2>&1 )
if [ ! -f "$REPO_ROOT/packages/web/dist/index.js" ]; then
  echo "build failed: packages/web/dist/index.js missing"; exit 1
fi

echo "== compiling the contract app (esbuild lowers the app's Stage-3 decorators) =="
( cd "$REPO_ROOT" && yarn exec esbuild "$HERE/app.ts" \
    --bundle --format=esm --platform=node --target=node20 \
    --outfile="$HERE/.app.mjs" >/dev/null 2>&1 ) || {
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

for _ in $(seq 1 40); do
  if curl -s -o /dev/null "$HOST/" 2>/dev/null; then break; fi
  sleep 0.25
done

echo "== verifying the shared contract (RSpec-equivalent) =="
if ! HOST="$HOST" node "$HERE/contract-check.mjs"; then
  echo "ABORT: contract check failed"; exit 1
fi

if ! resolve_oha; then
  echo
  echo "NOTE: 'oha' unavailable — contract verified but load run skipped (not faked)."
  echo "      Install oha (https://github.com/hatoo/oha) or allow the pinned download, then re-run."
  exit 0
fi
echo "== using oha: $OHA_BIN ($("$OHA_BIN" --version 2>/dev/null)) =="

IFS=',' read -r -a CONC_LIST <<< "$CONCURRENCIES"
IFS=',' read -r -a ROUTE_LIST <<< "$ROUTES"

# Accumulate the-benchmarker-shaped JSON as we go. metrics[] entries carry
# {level,label,value,route}; the dashboard aggregates by level and route.
METRICS_TMP="$(mktemp)"; echo "" > "$METRICS_TMP"
emit() { # level label value route
  printf '{"level":%s,"label":"%s","value":%s,"route":"%s"}\n' "$1" "$2" "$3" "$4" >> "$METRICS_TMP"
}

for CONC in "${CONC_LIST[@]}"; do
  OUTDIR="$HERE/.results/$CONC"
  mkdir -p "$OUTDIR"
  for ROUTE in "${ROUTE_LIST[@]}"; do
    METHOD="${ROUTE%%:*}"
    RPATH="${ROUTE#*:}"
    SAFE="$(echo "${METHOD}_${RPATH}" | tr '/:' '__')"
    JSON="$OUTDIR/${SAFE}.json"
    echo "== oha ${METHOD} ${RPATH} c=${CONC} for ${DURATION} (keep-alive off, latency-corrected) =="
    "$OHA_BIN" \
      -z "$DURATION" -c "$CONC" -m "$METHOD" \
      --disable-keepalive --latency-correction --no-tui \
      --output-format json \
      "$HOST$RPATH" > "$JSON" 2>/dev/null || { echo "oha run failed for $ROUTE"; continue; }

    # Map oha JSON -> upstream data.min.json labels (latency in seconds).
    read -r RPS AVG P50 P75 P90 P99 P99999 TOTREQ TOTDATA ERRS STDDEV DUR <<EOF
$(jq -r '
  [ (.summary.requestsPerSec),
    (.summary.average),
    (.latencyPercentiles.p50), (.latencyPercentiles.p75),
    (.latencyPercentiles.p90), (.latencyPercentiles.p99),
    (.latencyPercentiles["p99.99"] // .latencyPercentiles.p99),
    ((.summary.requestsPerSec * .summary.total) | floor),
    (.summary.totalData),
    ([ .statusCodeDistribution | to_entries[] | select((.key|tonumber) >= 400) | .value ] | add // 0),
    ((.summary.slowest - .summary.fastest)),
    ((.summary.total * 1000)) ] | @tsv' "$JSON")
EOF
    emit "$CONC" total_requests_per_s "$RPS" "$ROUTE"
    emit "$CONC" average_latency "$AVG" "$ROUTE"
    emit "$CONC" percentile50 "$P50" "$ROUTE"
    emit "$CONC" percentile75 "$P75" "$ROUTE"
    emit "$CONC" percentile90 "$P90" "$ROUTE"
    emit "$CONC" percentile99 "$P99" "$ROUTE"
    emit "$CONC" percentile99999 "$P99999" "$ROUTE"
    emit "$CONC" total_requests "$TOTREQ" "$ROUTE"
    emit "$CONC" total_bytes_received "$TOTDATA" "$ROUTE"
    emit "$CONC" http_errors "$ERRS" "$ROUTE"
    emit "$CONC" standard_deviation "$STDDEV" "$ROUTE"
    emit "$CONC" duration_ms "$DUR" "$ROUTE"
    printf '  req/s=%.0f  p50=%ss p90=%ss p99=%ss  errors=%s\n' "$RPS" "$P50" "$P90" "$P99" "$ERRS"
  done
done

# Assemble the final framework-results.json (measured=true) in the-benchmarker shape.
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MACHINE="$(uname -s) $(uname -m), Node $(node -v 2>/dev/null)"
jq -n \
  --arg now "$NOW" --arg machine "$MACHINE" --arg dur "$DURATION" \
  --arg oha "$("$OHA_BIN" --version 2>/dev/null)" \
  --argjson metrics "$(grep -v '^$' "$METRICS_TMP" | jq -s '.')" \
  '{
     suite: "the-benchmarker/web-frameworks",
     framework: "@zmdb/web",
     upstream: "https://github.com/the-benchmarker/web-frameworks",
     port: 3000,
     methodology: ("oha " + $oha + ": per route for " + $dur + ", keep-alive disabled (--disable-keepalive), latency-corrected (--latency-correction), JSON report. Levels + routes configurable, matching upstream. Metric labels mirror upstream data.min.json."),
     generatedAt: $now,
     machine: $machine,
     contract: [
       { method:"GET",  route:"/",         status:"2xx", body:"empty",                  pass:true },
       { method:"GET",  route:"/user/:id", status:"2xx", body:"the id path parameter",  pass:true },
       { method:"POST", route:"/user",     status:"2xx", body:"empty",                  pass:true }
     ],
     contractVerdict: "PASSED — @zmdb/web fulfills the the-benchmarker/web-frameworks shared contract (verified by contract-check.mjs before load).",
     throughput: { measured: true },
     metrics: $metrics
   }' > "$HERE/framework-results.json"
rm -f "$METRICS_TMP"

# Mirror into the dashboard data dir so the site picks it up on next docs build.
cp "$HERE/framework-results.json" "$REPO_ROOT/benchmarks/site/framework-results.json" 2>/dev/null || true

echo "DONE — wrote $HERE/framework-results.json (measured, the-benchmarker-shaped);"
echo "       raw oha JSON under $HERE/.results/<level>/; mirrored to benchmarks/site/."
