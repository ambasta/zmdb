#!/usr/bin/env bash
# Generate and run the populated-row full-vs-depth-1 benchmark.
#
# Usage:
#   bash benchmarks/harness/validation/run-shallow.sh
#   bash benchmarks/harness/validation/run-shallow.sh --write-final
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

node benchmarks/scripts/generate-validation-model.mjs >&2
node --import ./scripts/ts-specifier-hook.mjs benchmarks/harness/validation/shallow.bench.ts "$@"
