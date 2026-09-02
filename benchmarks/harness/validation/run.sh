#!/usr/bin/env bash
# Validation benchmark runner: zmdb's AOT and runtime validators against zod,
# @sinclair/typebox (compiled), ajv and valibot on moltar's data model.
#
# This harness installs its own dependencies into ./node_modules with npm rather
# than joining the workspace. The libraries under test are pinned to exact
# versions in package.json and must not float with the monorepo's resolutions —
# a validator benchmark where the competitor versions drift between runs is not
# comparable to its own history. npm is used because the root package.json sets
# a packageManager field, so plain `npm install` refuses to run; the
# COREPACK_ENABLE_STRICT=0 below is what gets past that.
#
# Output goes to stdout, and to ./validation-results.txt when OUT is unset.
#
# Usage:
#   ./run.sh                 # install if needed, then run
#   REPEATS=9 ./run.sh       # more passes per case (see validation.bench.ts)
#   OUT=/dev/null ./run.sh   # stdout only
set -euo pipefail
cd "$(dirname "$0")"

OUT="${OUT:-validation-results.txt}"

if [ ! -d node_modules ]; then
  echo "==> installing pinned validator dependencies"
  COREPACK_ENABLE_STRICT=0 npm install --no-audit --no-fund --ignore-scripts
fi

# The two zmdb rows are generated from `model.ts` — the IR for the runtime path, the
# inlined functions for the AOT path — so a stale generated file cannot be measured. This
# runs from the repository root, where `typescript` is installed: the checker is a child
# process the reflection spawns, and this harness's node_modules holds only the
# competitors.
echo "==> generating the zmdb validators from model.ts"
node ../../scripts/generate-validation-model.mjs

# Node strips the types natively; no build step and no bundler, so what runs is
# exactly what is in the file.
echo "==> running validation benchmark (this takes a few minutes)"
node validation.bench.ts | tee "$OUT"
