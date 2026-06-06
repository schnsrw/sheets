#!/usr/bin/env bash
# Prepare the vendored Univer fork for consumption by the sheet workspace.
#
# Runs:
#   1. `pnpm install` inside the fork to populate vendor/univer-revamp/node_modules
#   2. `pnpm build` inside the fork to produce lib/ outputs (.d.ts + .js)
#   3. swap-fork-pkgs.mjs to flip each fork package.json's `main` / `exports`
#      from the dev shape (./src/index.ts) to the consumable shape
#      (./lib/es/index.js etc.) — same swap upstream applies at publish time
#      via the publishConfig block.
#
# After this script, the sheet workspace's `pnpm install` resolves
# @univerjs/* via the `pnpm.overrides` block in the root package.json
# and tsc reads the built .d.ts files from lib/types/.
#
# Idempotent: re-running is safe. The swap script is reversible via
# `scripts/swap-fork-pkgs.mjs --restore`.
#
# Caller is responsible for checking out the submodule first
# (`git submodule update --init --recursive` or
# `actions/checkout@v4` with `submodules: recursive`).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
FORK_DIR="$REPO_ROOT/vendor/univer-revamp"

if [[ ! -d "$FORK_DIR" ]]; then
  echo "error: fork submodule not found at $FORK_DIR — run 'git submodule update --init --recursive' first" >&2
  exit 1
fi

echo "==> installing fork dependencies ($FORK_DIR)"
( cd "$FORK_DIR" && pnpm install --frozen-lockfile )

echo "==> building fork"
( cd "$FORK_DIR" && pnpm build )

echo "==> swapping fork package.json main/exports to use built lib/"
node "$REPO_ROOT/scripts/swap-fork-pkgs.mjs"

echo "==> fork ready; run 'pnpm install' at the repo root next."
