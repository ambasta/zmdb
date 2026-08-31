#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if git rev-parse --git-dir > /dev/null 2>&1; then
  chmod +x "$SCRIPT_DIR/pre-commit"
  git config --local core.hooksPath scripts
  echo "Git pre-commit hook configured: core.hooksPath set to 'scripts'"
else
  echo "Not inside a git repository; skipping pre-commit hook setup."
fi
