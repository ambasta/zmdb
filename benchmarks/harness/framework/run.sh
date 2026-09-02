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
# The serving runtime is selectable: RUNTIME=node (default) | bun | deno. The app
# is bundled once and all three run the same bundle, so a cross-runtime comparison
# varies only the runtime. Deno is auto-downloaded (pinned) into ./.bin like oha.
#
# Output: ./framework-results.json for node, ./framework-results-<runtime>.json
# otherwise (the-benchmarker-shaped, consumed by the dashboard) + raw per-route
# oha JSON under ./.results/<runtime>/<level>/.
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

# Which JS runtime serves the app: node | bun | deno. esbuild bundles the app to
# one ESM file, so all three run the same bytes — which is the point, since it
# leaves the runtime as the only variable.
#
# All three do implement `node:cluster` well enough for this app: on this box each
# forks and all workers bind the same port with no EADDRINUSE, so the shared-socket
# accept the app relies on (see app.ts) works everywhere and no runtime has to be
# pinned to WORKERS=1. Bun reports `cluster.SCHED_NONE` as undefined inside a
# worker, which is harmless — only the primary's value is read before forking.
#
# The runtime and its version go into the results JSON, because "@zmdb/web does N
# req/s" is not a claim you can make without naming which runtime served it.
RUNTIME="${RUNTIME:-node}"
DENO_VERSION="${DENO_VERSION:-v2.9.6}"
# Repetition, because a single sample of this workload is not a measurement.
# With --disable-keepalive every request opens a connection, so a run's result
# depends on the kernel's ephemeral-port/TIME_WAIT state, which is *inherited*
# from whatever ran before it: on this box ~26k of the 28k-port range sits in
# TIME_WAIT under load. A discarded warmup run drives the port table to that
# steady state before anything is recorded, and REPEATS runs are then reduced by
# median so one unlucky draw cannot set the published number. The observed
# min/max of the repeats is published alongside it, so a reader can see how much
# of any gap is real. WORKERS is passed to the app (see app.ts).
REPEATS="${REPEATS:-3}"
WARMUP="${WARMUP:-1}"
SETTLE="${SETTLE:-2}"

# Leave half the cores to the load generator. oha runs on THIS box, so server
# workers and the client compete for the same CPUs, and past a point another
# worker costs the client more than it gains the server. Measured on the real
# contract app, GET /, c=256, keep-alive off, median of 3:
#
#   workers    req/s   per-core   speedup
#         1    30594      30594      1.00x
#         2    48977      24488      1.60x
#         4    77351      19338      2.53x
#         8   109536      13692      3.58x   <- peak
#        16    87604       5475      2.86x   <- client starved
#
# Throughput peaks at half the cores and falls off at all of them; over the full
# 9-cell matrix, WORKERS=8 medians 74390 against WORKERS=16's 59523. The Go and
# Rust peers do take every core (GOMAXPROCS / num_cpus) and are not hurt by it,
# because they need far less CPU per request and so never starve the client.
# That asymmetry is the finding, not a thing to hide: the chosen worker count and
# the box's core count both go into the results JSON.
CORES_AVAIL="$(node -e 'process.stdout.write(String(require("node:os").availableParallelism()))' 2>/dev/null || nproc)"
WORKERS="${WORKERS:-$(( CORES_AVAIL / 2 > 0 ? CORES_AVAIL / 2 : 1 ))}"

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

# ---- runtime acquisition -----------------------------------------------------
# Deno gets the same treatment as oha: PATH, then the ./.bin cache, then a pinned
# prebuilt. Unlike oha it is NOT optional — the run was asked for on a specific
# runtime, and silently falling back to Node would publish a number under the
# wrong label, which is worse than not publishing one.
RUNTIME_BIN=""
RUNTIME_ARGS=()
resolve_deno() {
  if command -v deno >/dev/null 2>&1; then RUNTIME_BIN="$(command -v deno)"; return 0; fi
  local cached="$HERE/.bin/deno"
  if [ -x "$cached" ]; then RUNTIME_BIN="$cached"; return 0; fi
  local arch os asset
  arch="$(uname -m)"; os="$(uname -s)"
  case "$os/$arch" in
    Linux/x86_64|Linux/amd64) asset="deno-x86_64-unknown-linux-gnu.zip" ;;
    Linux/aarch64|Linux/arm64) asset="deno-aarch64-unknown-linux-gnu.zip" ;;
    Darwin/arm64) asset="deno-aarch64-apple-darwin.zip" ;;
    Darwin/x86_64) asset="deno-x86_64-apple-darwin.zip" ;;
    *) echo "  (no prebuilt deno for $os/$arch — install deno manually)"; return 1 ;;
  esac
  command -v unzip >/dev/null 2>&1 || { echo "  (unzip required to unpack deno)"; return 1; }
  echo "== fetching deno ${DENO_VERSION} (${asset}) =="
  mkdir -p "$HERE/.bin"
  local zip="$HERE/.bin/.deno.zip"
  if curl -sSL -m 180 -o "$zip" \
      "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/${asset}" 2>/dev/null \
    && [ -s "$zip" ] && unzip -oq "$zip" -d "$HERE/.bin" 2>/dev/null; then
    rm -f "$zip"; chmod +x "$cached" 2>/dev/null
    if "$cached" --version >/dev/null 2>&1; then RUNTIME_BIN="$cached"; return 0; fi
  fi
  rm -f "$zip" "$cached"; return 1
}

resolve_runtime() {
  case "$RUNTIME" in
    node)
      command -v node >/dev/null 2>&1 || { echo "RUNTIME=node but node is not on PATH"; return 1; }
      RUNTIME_BIN="$(command -v node)" ;;
    bun)
      command -v bun >/dev/null 2>&1 || { echo "RUNTIME=bun but bun is not on PATH"; return 1; }
      RUNTIME_BIN="$(command -v bun)"; RUNTIME_ARGS=(run) ;;
    deno)
      resolve_deno || { echo "RUNTIME=deno but deno could not be resolved"; return 1; }
      # Deno sandboxes by default, so every capability the app uses is spelled out
      # rather than reaching for `-A`. --allow-run is the non-obvious one:
      # `cluster.fork()` under Deno spawns the deno binary itself, and without it
      # the primary dies with NotCapable *after* announcing it is listening, so the
      # only symptom is a connection refused from the contract check.
      #
      # --unstable-net is the other one. Each Deno worker calls `Deno.serve`
      # itself, so they all need `reusePort` to bind the same port, and Deno still
      # gates that behind the flag. Without it every worker prints "Unstable API"
      # and none of them listens. Bun and Node need no equivalent: bun's
      # `reusePort` is stable and the Node path shares one listening socket via
      # cluster's SCHED_NONE.
      RUNTIME_ARGS=(run --allow-net --allow-env --allow-read --allow-run --unstable-net) ;;
    *)
      echo "unknown RUNTIME='$RUNTIME' (expected node | bun | deno)"; return 1 ;;
  esac
  # `deno --version` prints "deno 2.9.6 (...)" while node prints "v26.8.1", so the
  # tool name is stripped to keep "deno deno 2.9.6" out of the published JSON.
  RUNTIME_VERSION="$("$RUNTIME_BIN" --version 2>/dev/null | head -1 | sed "s/^$RUNTIME //")"
  return 0
}
RUNTIME_VERSION=""
resolve_runtime || exit 1

# The validator for `CreateDTO<User>`, recompiled from `model.ts`. The generated files
# are committed, so this is a no-op on an unchanged tree and the bundle below would work
# without it — it is here so that editing the interface cannot leave the measured app
# checking last week's shape. `--check` would only report the drift; the benchmark wants
# it fixed.
echo "== compiling the validator from model.ts (zmdb-codegen) =="
( cd "$REPO_ROOT" && node packages/aot-validator/src/cli/bin.ts --project "$HERE/tsconfig.json" ) || {
  echo "zmdb-codegen failed"; exit 1
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

echo "== starting the contract app on :$PORT ($WORKERS worker(s), $RUNTIME $RUNTIME_VERSION) =="
PORT="$PORT" WORKERS="$WORKERS" "$RUNTIME_BIN" ${RUNTIME_ARGS[@]+"${RUNTIME_ARGS[@]}"} "$HERE/.app.mjs" &
APP_PID=$!
cleanup() {
  # The app may be a cluster primary, so kill the whole process group to avoid
  # leaving workers holding the port.
  kill "$APP_PID" 2>/dev/null
  wait "$APP_PID" 2>/dev/null
  pkill -P "$APP_PID" 2>/dev/null
  rm -f "$HERE/.app.mjs"
}
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
  OUTDIR="$HERE/.results/$RUNTIME/$CONC"
  mkdir -p "$OUTDIR"
  for ROUTE in "${ROUTE_LIST[@]}"; do
    METHOD="${ROUTE%%:*}"
    RPATH="${ROUTE#*:}"
    SAFE="$(echo "${METHOD}_${RPATH}" | tr '/:' '__')"
    JSON="$OUTDIR/${SAFE}.json"
    echo "== oha ${METHOD} ${RPATH} c=${CONC} for ${DURATION} × ${REPEATS} (keep-alive off, latency-corrected) =="

    load() { # outfile
      "$OHA_BIN" \
        -z "$DURATION" -c "$CONC" -m "$METHOD" \
        --disable-keepalive --latency-correction --no-tui \
        --output-format json \
        "$HOST$RPATH" > "$1" 2>/dev/null
    }

    # Warmup: discarded. Its only job is to leave the kernel's port table in the
    # same saturated state every recorded run will see.
    for _ in $(seq 1 "$WARMUP"); do
      load "$OUTDIR/.warmup.json" || true
      sleep "$SETTLE"
    done

    # Recorded repeats.
    REP_FILES=()
    for r in $(seq 1 "$REPEATS"); do
      RJ="$OUTDIR/${SAFE}.run${r}.json"
      if load "$RJ"; then
        REP_FILES+=("$RJ")
        printf '   run %s/%s req/s=%.0f\n' "$r" "$REPEATS" "$(jq -r '.summary.requestsPerSec' "$RJ")"
      else
        echo "   run $r/$REPEATS FAILED"
      fi
      sleep "$SETTLE"
    done
    if [ "${#REP_FILES[@]}" -eq 0 ]; then echo "oha run failed for $ROUTE"; continue; fi

    # Reduce by median *run* (not per-metric median), so every published metric
    # for a cell comes from one real run and the percentiles stay consistent
    # with the throughput they were measured beside.
    MEDIAN_JSON="$(
      for f in "${REP_FILES[@]}"; do
        printf '%s\t%s\n' "$(jq -r '.summary.requestsPerSec' "$f")" "$f"
      done | sort -g | awk -v n="${#REP_FILES[@]}" 'NR==int((n+1)/2){print $2}'
    )"
    read -r RPS_MIN RPS_MAX <<EOF
$(for f in "${REP_FILES[@]}"; do jq -r '.summary.requestsPerSec' "$f"; done | sort -g | awk 'NR==1{min=$1}END{print min"\t"$1}')
EOF
    cp "$MEDIAN_JSON" "$JSON"
    rm -f "$OUTDIR/.warmup.json"

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
    # Publish the repeat spread so the dashboard can show what the median hides.
    emit "$CONC" requests_per_s_min "$RPS_MIN" "$ROUTE"
    emit "$CONC" requests_per_s_max "$RPS_MAX" "$ROUTE"
    emit "$CONC" repeats "${#REP_FILES[@]}" "$ROUTE"
    printf '  median req/s=%.0f (min %.0f, max %.0f of %s)  p50=%ss p90=%ss p99=%ss  errors=%s\n' \
      "$RPS" "$RPS_MIN" "$RPS_MAX" "${#REP_FILES[@]}" "$P50" "$P90" "$P99" "$ERRS"
  done
done

# Assemble the final framework-results.json (measured=true) in the-benchmarker shape.
#
# The default Node run keeps the canonical filename the dashboard already reads;
# a bun or deno run writes its own file so it cannot clobber the published Node
# number with one measured under a different label.
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CORES="$(nproc 2>/dev/null || echo unknown)"
MACHINE="$(uname -s) $(uname -m), ${CORES} cores, ${RUNTIME} ${RUNTIME_VERSION}"
case "$RUNTIME" in
  node) RESULTS="$HERE/framework-results.json" ;;
  *)    RESULTS="$HERE/framework-results-${RUNTIME}.json" ;;
esac
jq -n \
  --arg now "$NOW" --arg machine "$MACHINE" --arg dur "$DURATION" \
  --arg oha "$("$OHA_BIN" --version 2>/dev/null)" \
  --arg runtime "$RUNTIME" --arg runtimeVersion "$RUNTIME_VERSION" \
  --argjson workers "$WORKERS" --argjson cores "$CORES" --argjson repeats "$REPEATS" \
  --argjson metrics "$(grep -v '^$' "$METRICS_TMP" | jq -s '.')" \
  '{
     suite: "the-benchmarker/web-frameworks",
     framework: "@zmdb/web",
     runtime: $runtime,
     runtimeVersion: $runtimeVersion,
     upstream: "https://github.com/the-benchmarker/web-frameworks",
     port: 3000,
     methodology: ("Served on " + $runtime + " " + $runtimeVersion + ". oha " + $oha + ": per route for " + $dur + ", keep-alive disabled (--disable-keepalive), latency-corrected (--latency-correction), JSON report. Each cell is run " + ($repeats|tostring) + "x after a discarded warmup and reduced to the MEDIAN run; requests_per_s_min/max report the spread. Served by " + ($workers|tostring) + " worker process(es) on " + ($cores|tostring) + " cores. Levels + routes configurable, matching upstream. Metric labels mirror upstream data.min.json."),
     concurrencyModel: {
       workers: $workers,
       cores: $cores,
       note: "A JS runtime runs one thread per process, so worker count is the core count this framework can use; all three supported runtimes (node, bun, deno) fork via node:cluster and accept from a shared listening socket. Default is half the cores, not all of them: the load generator runs on this same box, and throughput measured here peaks at cores/2 (109536 req/s at 8 workers vs 87604 at 16, GET / c=256) because more workers starve the client. Go (GOMAXPROCS) and Rust (num_cpus) peers do take every core and are not hurt by it, needing far less CPU per request; peers on node/bun/deno use one core unless their own app clusters. Scaling is sublinear either way — 1 worker does 30594, so 8 returns 3.58x for 8x the cores. Set WORKERS=1 for a per-core reading."
     },
     repeats: $repeats,
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
   }' > "$RESULTS"
rm -f "$METRICS_TMP"

# Mirror into the dashboard data dir so the site picks it up on next docs build.
cp "$RESULTS" "$REPO_ROOT/benchmarks/site/$(basename "$RESULTS")" 2>/dev/null || true

echo "DONE — wrote $RESULTS (measured on $RUNTIME, the-benchmarker-shaped);"
echo "       raw oha JSON under $HERE/.results/$RUNTIME/<level>/; mirrored to benchmarks/site/."
