#!/usr/bin/env bash
# Interleaved head-to-head against the JS/TS class, plus the hand-written vs
# public-API A/B, in one experiment.
#
# WHY INTERLEAVED: this box thermally throttles from 5.13 GHz to ~2.8 GHz under
# sustained load, so a sequential block (candidate A's cells, then B's) is
# systematically biased against whoever runs later -- measured at up to 2x, which
# is larger than every margin here. Instead each PASS visits every candidate once
# and the candidate order ROTATES between passes, so no candidate keeps a
# favourable position and all of them see the same thermal trajectory on average.
# Per-candidate result is the median over passes.
#
# The CPU clock is sampled immediately before every measurement and recorded in
# the CSV, so a reader can see the throttling rather than trust that it averaged
# out.
#
# WHY THE PORT IS CHECKED SO PEDANTICALLY: the first draft killed the subshell and
# not the server it had spawned, so the previous candidate kept :3000, the next
# one's bind failed, and the readiness probe cheerfully got a 200 from the STALE
# server -- producing five different frameworks with identical throughput. Every
# candidate now starts in its own process group, is killed by group, and the port
# is asserted free both before the start and after the stop.
#
# Peers must already be staged and installed by `peers-run.sh` (it copies each one
# to /tmp/zmdb-peers/<id> and installs its deps there); this runner only starts and
# measures them, so the installs are not repeated inside a timed experiment.
#
# Output: a CSV of every individual measurement on stdout, plus
# ./interleaved-results.json with the per-candidate medians.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
FW="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$FW/../../.." && pwd)"
OHA="$FW/.bin/oha"
STAGE=/tmp/zmdb-peers
OUT="${OUT:-/tmp/zmdb-interleaved}"
PORT=3000
DUR="${DUR:-10s}"
CONC="${CONC:-256}"
PASSES="${PASSES:-5}"
WARM="${WARM:-5s}"
KEEPALIVE="${KEEPALIVE:-0}"   # 1 = keep-alive on (measures the framework, not the port table)
RESULTS="${RESULTS:-$HERE/interleaved-results.json}"
CSV="$OUT/measurements.csv"

mkdir -p "$OUT"
export PATH="$FW/.bin:$PATH"   # the fetched deno, exactly as peers-run.sh does it

KA=(--disable-keepalive)
[ "$KEEPALIVE" = 1 ] && KA=()

avg_mhz() { awk '/cpu MHz/{s+=$4;n++}END{printf "%.0f", s/n}' /proc/cpuinfo; }

port_holder() { ss -ltnpH 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2; }

wait_port_free() { # max_s -> 0 free, 1 still held
  local waited=0 h
  while :; do
    h="$(port_holder)"
    [ -z "$h" ] && return 0
    [ "$waited" -ge "$1" ] && { kill -9 "$h" 2>/dev/null; sleep 2; [ -z "$(port_holder)" ] && return 0; return 1; }
    sleep 1; waited=$((waited+1))
  done
}

cooldown() { # target_mhz max_wait_s
  local waited=0
  while [ "$(avg_mhz)" -lt "$1" ] && [ "$waited" -lt "$2" ]; do sleep 15; waited=$((waited+15)); done
  echo "# clock $(avg_mhz) MHz after ${waited}s of cooldown" >&2
}

# --- build our two variants (public API now, hand-written at HEAD) ------------
# `yarn --cwd` is not a yarn 4 flag; it silently did nothing here and the first
# draft measured a bundle that had never been written. Run esbuild from the repo
# root in a subshell instead.
SRC_A="$FW/.app-handwritten.ts"
git -C "$ROOT" show HEAD:benchmarks/harness/framework/app.ts > "$SRC_A"
( cd "$ROOT" && yarn workspace @zmdb/web build ) >/dev/null 2>&1
( cd "$ROOT" && yarn exec esbuild "$SRC_A" --bundle --format=esm --platform=node \
    --target=node20 --outfile="$OUT/handwritten.mjs" ) >/dev/null 2>&1
( cd "$ROOT" && yarn exec esbuild "$FW/app.ts" --bundle --format=esm --platform=node \
    --target=node20 --outfile="$OUT/publicapi.mjs" ) >/dev/null 2>&1
rm -f "$SRC_A"
for f in "$OUT/handwritten.mjs" "$OUT/publicapi.mjs"; do
  [ -s "$f" ] || { echo "FATAL: $f was not built" >&2; exit 1; }
done

# --- candidate table: id|cwd|command ----------------------------------------
# Ours run with WORKERS=1, because every JS peer here serves from a single process
# (none of their apps cluster) -- so this is the per-core, like-for-like reading.
CANDIDATES=(
  "zmdb-node|$OUT|node $OUT/publicapi.mjs"
  "zmdb-node-handwritten|$OUT|node $OUT/handwritten.mjs"
  "zmdb-bun|$OUT|bun run $OUT/publicapi.mjs"
  "zmdb-deno|$OUT|deno run --allow-net --allow-env --allow-read --allow-run --unstable-net $OUT/publicapi.mjs"
  "fastify|$STAGE/fastify|node app.mjs"
  "hono-node|$STAGE/hono-node|node app.mjs"
  "express|$STAGE/express|node app.mjs"
  "koa|$STAGE/koa|node app.mjs"
  "elysia-bun|$STAGE/elysia-bun|bun run app.ts"
  "hono-bun|$STAGE/hono-bun|bun run app.ts"
  "hono-deno|$STAGE/hono-deno|deno run -A app.ts"
  "oak-deno|$STAGE/oak-deno|deno run -A app.ts"
)
N=${#CANDIDATES[@]}

one() { # id cwd cmd pass
  local id="$1" cwd="$2" cmd="$3" pass="$4"
  [ -d "$cwd" ] || { echo "$pass,$id,,,MISSING_DIR"; return; }
  wait_port_free 20 || { echo "$pass,$id,,,PORT_BUSY"; return; }

  # setsid: the server gets its own process group, so the whole tree can be torn
  # down by group id and nothing survives to hold the port.
  ( cd "$cwd" && exec setsid env PORT=$PORT WORKERS=1 $cmd >"$OUT/$id.run.log" 2>&1 ) &
  local shell_pid=$!
  local ready=0
  for _ in $(seq 1 80); do
    if curl -s -o /dev/null --max-time 1 "http://localhost:$PORT/" 2>/dev/null; then ready=1; break; fi
    sleep 0.25
  done
  local holder; holder="$(port_holder)"
  if [ "$ready" -eq 0 ] || [ -z "$holder" ]; then
    [ -n "$holder" ] && kill -9 "$holder" 2>/dev/null
    kill "$shell_pid" 2>/dev/null; wait "$shell_pid" 2>/dev/null
    echo "$pass,$id,,,NOT_READY"; wait_port_free 10 || true; return
  fi
  local pgid; pgid="$(ps -o pgid= -p "$holder" 2>/dev/null | tr -d ' ')"

  "$OHA" -z "$WARM" -c "$CONC" "${KA[@]+"${KA[@]}"}" --latency-correction --no-tui \
    --output-format json "http://localhost:$PORT/" >/dev/null 2>&1
  sleep 1
  local mhz; mhz="$(avg_mhz)"
  local j="$OUT/$id.p$pass.json"
  "$OHA" -z "$DUR" -c "$CONC" "${KA[@]+"${KA[@]}"}" --latency-correction --no-tui \
    --output-format json "http://localhost:$PORT/" > "$j" 2>/dev/null
  local rps p99
  rps="$(jq -r '.summary.requestsPerSec // empty' "$j" 2>/dev/null)"
  p99="$(jq -r '.latencyPercentiles.p99 // empty' "$j" 2>/dev/null)"

  [ -n "$pgid" ] && kill -- "-$pgid" 2>/dev/null
  kill "$shell_pid" 2>/dev/null; wait "$shell_pid" 2>/dev/null
  wait_port_free 15 || echo "# WARN: $id left :$PORT held" >&2
  sleep 2
  printf '%s,%s,%s,%.0f,%s\n' "$pass" "$id" "$mhz" "${rps:-0}" "${p99:-}"
}

: > "$CSV"
tee_line() { echo "$1"; echo "$1" >> "$CSV"; }

tee_line "pass,candidate,mhz,rps,p99"
cooldown 4200 240
for p in $(seq 1 "$PASSES"); do
  for i in $(seq 0 $((N-1))); do
    # Rotate the visiting order by one each pass, so position in the thermal ramp
    # is not a fixed property of a candidate.
    idx=$(( (i + p - 1) % N ))
    IFS='|' read -r id cwd cmd <<< "${CANDIDATES[$idx]}"
    tee_line "$(one "$id" "$cwd" "$cmd" "$p")"
  done
done

# --- reduce to per-candidate medians ----------------------------------------
# Median over passes, plus the pass spread (max/min), which is the yardstick a
# reader needs: if a margin between two candidates is inside their spreads, it is
# not a result. Failed measurements (rps 0) are dropped rather than averaged in.
echo "== per-candidate medians (median of $PASSES passes) =="
SUMMARY="$(
  awk -F, 'NR>1 && $4+0>0 {print $2, $4}' "$CSV" | sort | awk '
    { v[$1] = ($1 in v ? v[$1] " " $2 : $2) }
    END {
      for (k in v) {
        n = split(v[k], a, " ")
        for (i = 1; i <= n; i++) for (j = i + 1; j <= n; j++) if (a[j] + 0 < a[i] + 0) { t = a[i]; a[i] = a[j]; a[j] = t }
        lo = a[1] + 0; hi = a[n] + 0
        printf "%d\t%s\t%.2f\t%d\n", a[int((n + 1) / 2)], k, (lo > 0 ? hi / lo : 0), n
      }
    }' | sort -rn
)"
printf 'req/s\tcandidate\tspread\tpasses\n%s\n' "$SUMMARY"

jq -n \
  --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg dur "$DUR" --arg conc "$CONC" --argjson passes "$PASSES" \
  --arg machine "$(uname -s) $(uname -m), $(nproc 2>/dev/null || echo '?') cores" \
  --arg keepalive "$([ "$KEEPALIVE" = 1 ] && echo on || echo off)" \
  --argjson entries "$(printf '%s\n' "$SUMMARY" | jq -R -s 'split("\n") | map(select(length>0) | split("\t")) | map({candidate:.[1], medianRequestsPerSec:(.[0]|tonumber), passSpread:(.[2]|tonumber), passes:(.[3]|tonumber)})')" \
  '{
     suite: "the-benchmarker/web-frameworks (interleaved head-to-head)",
     generatedAt: $now,
     machine: $machine,
     route: "GET /",
     concurrency: ($conc|tonumber),
     duration: $dur,
     keepAlive: $keepalive,
     passes: $passes,
     workersPerCandidate: 1,
     methodology: "Every pass visits every candidate once and the visiting order rotates between passes, so no candidate holds a fixed position in the thermal ramp. This machine throttles from 5.13 GHz to ~2.8 GHz under sustained load (a 1.85x clock swing), which biases any sequential benchmark toward whatever runs first; the identical code path medianed 76871 and 93647 req/s in two different sequential sessions. Per candidate the result is the MEDIAN over passes and passSpread is max/min - a margin inside the spreads is not a result. The CPU clock is sampled before every measurement and kept in measurements.csv. Each candidate serves from ONE process, because no peer app clusters.",
     results: $entries
   }' > "$RESULTS"

# Mirror into the dashboard data dir, the same way run.sh and peers-run.sh do, so
# the docs build picks this up instead of it living only in the harness directory.
# The CSV goes too: the medians table is a summary, and the per-measurement clock
# is the evidence that the rotation actually did its job.
cp "$RESULTS" "$ROOT/benchmarks/site/$(basename "$RESULTS")" 2>/dev/null || true
cp "$CSV" "$HERE/interleaved-measurements.csv" 2>/dev/null || true
cp "$CSV" "$ROOT/benchmarks/site/interleaved-measurements.csv" 2>/dev/null || true

echo "DONE — $RESULTS (medians); $CSV (every measurement, with the clock it was taken at); mirrored to benchmarks/site/"
