# Shared setup for the ORM k6 runners. Sourced, not executed.
#
# Everything is derived from where the sourcing script lives, so a fresh clone
# can run the benchmarks without first recreating somebody's scratch directory.
# Each value can still be overridden from the environment.
#
# The preflight checks below are the point of this file. Every one of these
# conditions used to fail silently mid-run and still print a table — of zeros,
# or worse, of one ORM's real numbers beside another's zeros, which reads as a
# result rather than as a broken run.

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[1]}")" && pwd)
ROOT=$(cd -- "$HERE/../../.." && pwd)
cd "$HERE" || exit 1

WORK="${WORK:-${TMPDIR:-/tmp}/zmdb-ormbench}"
# k6 is a single static Go binary, not a repo dependency, so look for it on PATH
# first and then in the work dir.
K6="${K6:-$(command -v k6 || true)}"
[ -n "$K6" ] || K6="$WORK/k6"
REQ="${REQ:-$ROOT/benchmarks/upstream/drizzle-benchmarks/data/requests.json}"
REPEATS="${REPEATS:-3}"
WARMUP="${WARMUP:-1}"
PGURL="${PGURL:-${DATABASE_URL:-postgres://postgres:postgres@localhost:55432/bench}}"

# k6 only exports avg,min,med,max,p(90),p(95) unless asked. p(99) is the
# interesting one for a tail — without this flag the reporter's p99 column reads
# a field that is not there and prints zeros, which looks like a great tail.
TREND_STATS="${TREND_STATS:-avg,min,med,p(90),p(95),p(99),max}"

ORMS="${ORMS:-zmdb}"
PORT_BASE="${PORT_BASE:-3000}"

mkdir -p "$WORK"

die() {
  echo "${BASH_SOURCE[1]##*/}: $1" >&2
  exit 1
}

[[ "$PORT_BASE" =~ ^[0-9]+$ ]] || die "PORT_BASE must be an integer"
((10#$PORT_BASE > 0 && 10#$PORT_BASE <= 65533)) || die "PORT_BASE must be between 1 and 65533"
declare -A PORT=([drizzle]=$((10#$PORT_BASE)) [kysely]=$((10#$PORT_BASE + 1)) [zmdb]=$((10#$PORT_BASE + 2)))

[ -n "$K6" ] && [ -x "$K6" ] || die "k6 not found (set K6=/path/to/k6 or put it on PATH)"
[ -f "$REQ" ] || die "request replay data missing: $REQ
  the drizzle-benchmarks submodule is probably not checked out:
    git submodule update --init benchmarks/upstream/drizzle-benchmarks"
[ -d node_modules ] || die "dependencies not installed; run: COREPACK_ENABLE_STRICT=0 npm install"

PGURL="$PGURL" node -e '
  const { Client } = require("pg");
  const c = new Client(process.env.PGURL);
  c.connect()
    .then(() => c.query("select count(*)::int n from orders"))
    .then(r => {
      if (!r.rows[0].n) throw new Error("table `orders` is empty - run load-pg-full.mjs");
    })
    .then(() => c.end())
    .catch(e => {
      console.error(e.message);
      process.exit(1);
    });
' || die "cannot reach a seeded Postgres at $PGURL"

# Start one ORM server and wait until it actually answers. Echoes the pid.
start_server() { # $1=orm $2=port $3=logfile
  PGURL="$PGURL" ORM=$1 PORT=$2 node --import "$ROOT/scripts/ts-specifier-hook.mjs" server.ts >"$3" 2>&1 &
  local pid=$!
  SERVER_PID=$pid
  local i
  for i in $(seq 1 40); do
    if curl -sf -o /dev/null "http://localhost:$2/customer-by-id?id=1" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "server for $1 exited during startup; see $3" >&2
      tail -5 "$3" >&2
      wait "$pid" 2>/dev/null || true
      return 1
    fi
    sleep 0.5
  done
  echo "server for $1 never became ready; see $3" >&2
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  return 1
}

stop_server() { # $1=pid
  kill "$1" 2>/dev/null || true
  wait "$1" 2>/dev/null || true
  sleep 1
}
