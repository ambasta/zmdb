#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PRE_COMMIT_SRC="$SCRIPT_DIR/pre-commit"

if git rev-parse --git-dir > /dev/null 2>&1; then
  git config --local core.hooksPath .git/hooks
  HOOKS_DIR="$(git rev-parse --git-path hooks)"
  mkdir -p "$HOOKS_DIR"
  cp "$PRE_COMMIT_SRC" "$HOOKS_DIR/pre-commit"
  chmod +x "$HOOKS_DIR/pre-commit"
  echo "Native Git pre-commit hook successfully installed at $HOOKS_DIR/pre-commit"
else
  echo "Not inside a git repository; skipping pre-commit hook installation."
fi
