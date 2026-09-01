#!/usr/bin/env bash
# Same-machine, apples-to-apples the-benchmarker peer head-to-head for @zmdb/web.
# For each peer in peers.json: detect toolchain -> install/build -> start on
# $PORT -> verify the SHARED CONTRACT (contract-check.mjs) -> load-test with the
# IDENTICAL oha invocation, levels and routes used for @zmdb/web. Peers whose
# toolchain/build/contract is unavailable are recorded as "skipped" with a reason
# (never faked). Emits peers-results.json (the-benchmarker metric shape).
#
# Honesty: same box, same oha binary, same duration/levels/routes as @zmdb/web,
# per-peer contract verified before any number is recorded.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"          # .../peers
FW="$(cd "$HERE/.." && pwd)"                    # .../framework
REPO_ROOT="$(cd "$FW/../../.." && pwd)"
PORT="${PORT:-3000}"
HOST="http://localhost:${PORT}"
DURATION="${DURATION:-15s}"
CONCURRENCIES="${CONCURRENCIES:-64,256,512}"
ROUTES="${ROUTES:-GET:/,GET:/user/42,POST:/user}"
OHA_VERSION="${OHA_VERSION:-v1.16.0}"
# Same repetition treatment as ../run.sh — a warmup run to bring the kernel's
# ephemeral-port table to steady state, then REPEATS recorded runs reduced by
# median. Peers must get exactly this, or the head-to-head compares a median
# against a single draw.
REPEATS="${REPEATS:-3}"
WARMUP="${WARMUP:-1}"
SETTLE="${SETTLE:-2}"
DENO_VERSION="${DENO_VERSION:-v2.9.6}"
ONLY="${ONLY:-}"                                # optional CSV of peer ids to run
export PATH="/usr/lib/go/bin:$PATH"             # Go lives here on this box
# The surrounding repo is a Corepack-managed Yarn workspace; peers are standalone
# npm/bun projects, so bypass Corepack's project packageManager pin for them.
export COREPACK_ENABLE_PROJECT_SPEC=0
export COREPACK_ENABLE_STRICT=0

BIN="$FW/.bin"; mkdir -p "$BIN"
export PATH="$BIN:$PATH"                         # a fetched deno lives here

# ---- oha (reuse the pinned binary the main runner uses) ----------------------
OHA_BIN=""
resolve_oha() {
  if [ -x "$BIN/oha" ]; then OHA_BIN="$BIN/oha"; return 0; fi
  if command -v oha >/dev/null 2>&1; then OHA_BIN="$(command -v oha)"; return 0; fi
  local asset; case "$(uname -s)/$(uname -m)" in
    Linux/x86_64) asset="oha-linux-amd64" ;; Linux/aarch64) asset="oha-linux-arm64" ;;
    *) return 1 ;; esac
  curl -sSL -m 120 -o "$BIN/oha" "https://github.com/hatoo/oha/releases/download/${OHA_VERSION}/${asset}" 2>/dev/null \
    && chmod +x "$BIN/oha" && "$BIN/oha" --version >/dev/null 2>&1 && { OHA_BIN="$BIN/oha"; return 0; }
  rm -f "$BIN/oha"; return 1
}
# ---- deno (fetch prebuilt if absent) -----------------------------------------
ensure_deno() {
  if command -v deno >/dev/null 2>&1; then echo "deno"; return 0; fi
  if [ -x "$BIN/deno" ]; then echo "$BIN/deno"; return 0; fi
  [ "$(uname -s)/$(uname -m)" = "Linux/x86_64" ] || return 1
  local z="$BIN/deno.zip"
  curl -sSL -m 180 -o "$z" "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" 2>/dev/null || return 1
  ( cd "$BIN" && unzip -oq deno.zip ) && chmod +x "$BIN/deno" && rm -f "$z" && { echo "$BIN/deno"; return 0; }
  return 1
}

if ! resolve_oha; then echo "FATAL: oha unavailable — cannot run peer load."; exit 1; fi
echo "== oha: $OHA_BIN ($("$OHA_BIN" --version)) =="

IFS=',' read -r -a CONC_LIST <<< "$CONCURRENCIES"
IFS=',' read -r -a ROUTE_LIST <<< "$ROUTES"

METRICS="$(mktemp)"; : > "$METRICS"
PEERMETA="$(mktemp)"; : > "$PEERMETA"   # one json object per peer

want() { [ -z "$ONLY" ] && return 0; case ",$ONLY," in *",$1,"*) return 0;; *) return 1;; esac }

run_peer() {  # id runtime language dir need venv install start
  local id="$1" runtime="$2" language="$3" dir="$4" need="$5" venv="$6" install="$7" start="$8"
  local SRC="$HERE/$dir"
  local D="/tmp/zmdb-peers/$id"     # staged OUTSIDE the PnP monorepo
  want "$id" || return 0

  # toolchain detection (deno/go may be fetched/pathed)
  local tool_ok=1 version="n/a" DENO=""
  case "$need" in
    deno) DENO="$(ensure_deno)" || tool_ok=0; [ "$tool_ok" = 1 ] && version="$("$DENO" --version 2>/dev/null | head -1)";;
    go)   command -v go >/dev/null 2>&1 && version="$(go version)" || tool_ok=0;;
    cargo)command -v cargo >/dev/null 2>&1 && version="$(cargo --version)" || tool_ok=0;;
    bun)  command -v bun >/dev/null 2>&1 && version="$(bun --version)" || tool_ok=0;;
    node) command -v node >/dev/null 2>&1 && version="$(node -v)" || tool_ok=0;;
    python3) command -v python3 >/dev/null 2>&1 && version="$(python3 --version)" || tool_ok=0;;
  esac
  if [ "$tool_ok" != 1 ]; then
    echo "-- SKIP $id ($runtime): toolchain '$need' absent"
    printf '{"id":"%s","runtime":"%s","language":"%s","status":"skipped","reason":"toolchain %s absent"}\n' "$id" "$runtime" "$language" "$need" >> "$PEERMETA"
    return 0
  fi

  echo "== $id ($runtime, $version) — stage + install/build =="
  rm -rf "$D"; mkdir -p "$D"; cp -r "$SRC"/. "$D"/     # copy sources to /tmp
  ( cd "$D"
    if [ "$venv" = "true" ]; then
      python3 -m venv .venv >/dev/null 2>&1 || true
      # shellcheck disable=SC1091
      . .venv/bin/activate
      python -m ensurepip -q >/dev/null 2>&1 || true
      python -m pip install -q --upgrade pip >/dev/null 2>&1 || true
    fi
    eval "$install"
  ) > "$D/.build.log" 2>&1
  if [ $? -ne 0 ]; then
    echo "-- SKIP $id: build/install failed (see /tmp/zmdb-peers/$id/.build.log)"
    printf '{"id":"%s","runtime":"%s","language":"%s","status":"skipped","reason":"build/install failed"}\n' "$id" "$runtime" "$language" >> "$PEERMETA"
    return 0
  fi

  # start (single detached pid; killed by pid — no process groups)
  echo "== $id — start on :$PORT =="
  local APP_PID
  if [ "$venv" = "true" ]; then
    ( cd "$D" && . .venv/bin/activate && PORT="$PORT" exec bash -c "$start" ) > "$D/.run.log" 2>&1 &
  else
    ( cd "$D" && PORT="$PORT" DENO="$DENO" exec bash -c "$start" ) > "$D/.run.log" 2>&1 &
  fi
  APP_PID=$!
  local up=0; for _ in $(seq 1 80); do curl -s -o /dev/null "$HOST/" 2>/dev/null && { up=1; break; }; sleep 0.25; done
  stop() {
    kill "$APP_PID" 2>/dev/null; wait "$APP_PID" 2>/dev/null
    # belt-and-suspenders: free the port if a child outlived the parent
    fuser -k "${PORT}/tcp" 2>/dev/null; sleep 0.3
  }
  if [ "$up" != 1 ]; then
    echo "-- SKIP $id: did not become ready (see /tmp/zmdb-peers/$id/.run.log)"; stop
    printf '{"id":"%s","runtime":"%s","language":"%s","status":"skipped","reason":"did not start"}\n' "$id" "$runtime" "$language" >> "$PEERMETA"
    return 0
  fi

  # contract
  if ! HOST="$HOST" node "$FW/contract-check.mjs" >/dev/null 2>&1; then
    echo "-- SKIP $id: contract check FAILED (not compliant)"; stop
    printf '{"id":"%s","runtime":"%s","language":"%s","status":"skipped","reason":"contract failed"}\n' "$id" "$runtime" "$language" >> "$PEERMETA"
    return 0
  fi
  echo "   contract OK"

  # load
  local OUT="$D/.results"; mkdir -p "$OUT"
  for CONC in "${CONC_LIST[@]}"; do
    for ROUTE in "${ROUTE_LIST[@]}"; do
      local M="${ROUTE%%:*}" P="${ROUTE#*:}"
      local BASE="$OUT/c${CONC}_$(echo "${M}_${P}" | tr '/:' '__')"
      local J="$BASE.json"
      for _ in $(seq 1 "$WARMUP"); do
        "$OHA_BIN" -z "$DURATION" -c "$CONC" -m "$M" --disable-keepalive --latency-correction --no-tui --output-format json "$HOST$P" > "$BASE.warmup.json" 2>/dev/null || true
        sleep "$SETTLE"
      done
      local REPS=() r RJ
      for r in $(seq 1 "$REPEATS"); do
        RJ="$BASE.run$r.json"
        if "$OHA_BIN" -z "$DURATION" -c "$CONC" -m "$M" --disable-keepalive --latency-correction --no-tui --output-format json "$HOST$P" > "$RJ" 2>/dev/null; then
          REPS+=("$RJ")
        fi
        sleep "$SETTLE"
      done
      [ "${#REPS[@]}" -eq 0 ] && continue
      # Median run, so each cell's percentiles come from the same real run as its throughput.
      cp "$(for f in "${REPS[@]}"; do printf '%s\t%s\n' "$(jq -r '.summary.requestsPerSec' "$f")" "$f"; done | sort -g | awk -v n="${#REPS[@]}" 'NR==int((n+1)/2){print $2}')" "$J"
      local RMIN RMAX
      read -r RMIN RMAX <<EOF2
$(for f in "${REPS[@]}"; do jq -r '.summary.requestsPerSec' "$f"; done | sort -g | awk 'NR==1{min=$1}END{print min"\t"$1}')
EOF2
      rm -f "$BASE.warmup.json"
      read -r RPS AVG P50 P90 P99 ERRS <<EOF
$(jq -r '[ (.summary.requestsPerSec), (.summary.average), (.latencyPercentiles.p50), (.latencyPercentiles.p90), (.latencyPercentiles.p99), ([ .statusCodeDistribution|to_entries[]|select((.key|tonumber)>=400)|.value ]|add // 0) ] | @tsv' "$J")
EOF
      printf '{"id":"%s","runtime":"%s","language":"%s","level":%s,"route":"%s","label":"total_requests_per_s","value":%s}\n' "$id" "$runtime" "$language" "$CONC" "$ROUTE" "$RPS" >> "$METRICS"
      printf '{"id":"%s","runtime":"%s","language":"%s","level":%s,"route":"%s","label":"average_latency","value":%s}\n' "$id" "$runtime" "$language" "$CONC" "$ROUTE" "$AVG" >> "$METRICS"
      printf '{"id":"%s","runtime":"%s","language":"%s","level":%s,"route":"%s","label":"percentile50","value":%s}\n' "$id" "$runtime" "$language" "$CONC" "$ROUTE" "$P50" >> "$METRICS"
      printf '{"id":"%s","runtime":"%s","language":"%s","level":%s,"route":"%s","label":"percentile90","value":%s}\n' "$id" "$runtime" "$language" "$CONC" "$ROUTE" "$P90" >> "$METRICS"
      printf '{"id":"%s","runtime":"%s","language":"%s","level":%s,"route":"%s","label":"percentile99","value":%s}\n' "$id" "$runtime" "$language" "$CONC" "$ROUTE" "$P99" >> "$METRICS"
      printf '{"id":"%s","runtime":"%s","language":"%s","level":%s,"route":"%s","label":"http_errors","value":%s}\n' "$id" "$runtime" "$language" "$CONC" "$ROUTE" "$ERRS" >> "$METRICS"
      printf '{"id":"%s","runtime":"%s","language":"%s","level":%s,"route":"%s","label":"requests_per_s_min","value":%s}\n' "$id" "$runtime" "$language" "$CONC" "$ROUTE" "$RMIN" >> "$METRICS"
      printf '{"id":"%s","runtime":"%s","language":"%s","level":%s,"route":"%s","label":"requests_per_s_max","value":%s}\n' "$id" "$runtime" "$language" "$CONC" "$ROUTE" "$RMAX" >> "$METRICS"
      printf '  c=%-3s %-14s median req/s=%.0f (min %.0f max %.0f of %s) p99=%ss errs=%s\n' "$CONC" "$ROUTE" "$RPS" "$RMIN" "$RMAX" "${#REPS[@]}" "$P99" "$ERRS"
    done
  done
  printf '{"id":"%s","runtime":"%s","language":"%s","version":%s,"status":"ok"}\n' "$id" "$runtime" "$language" "$(jq -Rn --arg v "$version" '$v')" >> "$PEERMETA"
  stop
  sleep 0.5
}

# iterate peers.json
PEERS_JSON="$HERE/peers.json"
COUNT="$(jq '.peers | length' "$PEERS_JSON")"
for i in $(seq 0 $((COUNT-1))); do
  IFS=$'\t' read -r id runtime language dir need venv install start < <(
    jq -r --argjson i "$i" '.peers[$i] | [.id,.runtime,.language,.dir,.need,(.venv//false),.install,.start] | @tsv' "$PEERS_JSON")
  run_peer "$id" "$runtime" "$language" "$dir" "$need" "$venv" "$install" "$start"
done

# assemble peers-results.json (slurpfile avoids ARG_MAX on the metric array)
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MACHINE="$(uname -s) $(uname -m), Node $(node -v 2>/dev/null)"
METRICS_ARR="$(mktemp)"; PEERS_ARR="$(mktemp)"
grep -v '^$' "$METRICS" | jq -s '.' > "$METRICS_ARR"
grep -v '^$' "$PEERMETA" | jq -s '.' > "$PEERS_ARR"
jq -n \
  --arg now "$NOW" --arg machine "$MACHINE" --arg dur "$DURATION" --arg oha "$("$OHA_BIN" --version)" \
  --argjson cores "$(nproc 2>/dev/null || echo 0)" --argjson repeats "$REPEATS" \
  --slurpfile metrics "$METRICS_ARR" \
  --slurpfile peers "$PEERS_ARR" \
  '{
     suite: "the-benchmarker/web-frameworks (same machine)",
     upstream: "https://github.com/the-benchmarker/web-frameworks",
     methodology: ("Same box, same oha " + $oha + ", same contract + routes + levels as @zmdb/web. Per route for " + $dur + ", keep-alive disabled, latency-corrected. Each cell run " + ($repeats|tostring) + "x after a discarded warmup and reduced to the MEDIAN run; requests_per_s_min/max give the spread. Each peer contract-verified before load. CORE USAGE IS NOT NORMALIZED: Go peers use GOMAXPROCS (all " + ($cores|tostring) + " cores) and Rust peers num_cpus by default, while node/bun/deno peers use one core unless their app clusters — so cross-runtime rows are not per-core comparable."),
     cores: $cores,
     repeats: $repeats,
     generatedAt: $now, machine: $machine, duration: $dur,
     peers: $peers[0], metrics: $metrics[0]
   }' > "$HERE/peers-results.json"
cp "$HERE/peers-results.json" "$REPO_ROOT/benchmarks/site/peers-results.json" 2>/dev/null || true
rm -f "$METRICS" "$PEERMETA" "$METRICS_ARR" "$PEERS_ARR"

echo "DONE — $HERE/peers-results.json"
jq -r '.peers[] | "  \(.id) [\(.runtime)]: \(.status)\(if .reason then " ("+.reason+")" else "" end)"' "$HERE/peers-results.json"
