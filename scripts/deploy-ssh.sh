#!/usr/bin/env bash
#
# The forced command of the deploy key in the server's authorized_keys: whatever the client asks,
# this runs. The client may only say WHICH commit, as `deploy <40-hex sha>`, and that commit must
# be on `main` — the one CI has just passed (.github/workflows/ci.yml). The checkout moves to it,
# and its own scripts/deploy.sh takes over.
#
# The exact commit, never "the latest main": with a passing push followed by a failing one, pulling
# the latest would deploy the second on the strength of the first's green run.
#
# All in a function, read whole before it runs: bash reads a script as it executes it, and the
# checkout below rewrites this very file.
set -euo pipefail

main() {
  local verb sha extra
  read -r verb sha extra <<<"${SSH_ORIGINAL_COMMAND:-}"
  if [[ ${verb:-} != deploy || ! ${sha:-} =~ ^[0-9a-f]{40}$ || -n ${extra:-} ]]; then
    echo "usage: deploy <40-character commit sha>" >&2
    exit 64
  fi

  cd "$(dirname "$0")/.."
  git fetch --quiet origin main
  if ! git merge-base --is-ancestor "$sha" origin/main; then
    echo "$sha is not on main: refusing to deploy it" >&2
    exit 65
  fi
  git checkout --quiet --detach "$sha"
  exec ./scripts/deploy.sh
}

main
exit
