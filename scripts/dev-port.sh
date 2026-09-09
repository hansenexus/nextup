#!/usr/bin/env bash
# dev-port.sh — this worktree's dev port.
#
# The dev server binds a fixed port (4177). Run two Orca lanes at once and the
# second one either dies on EADDRINUSE or, worse, does not: the first lane
# already owns the port, so the browser reaches THAT server and you review one
# lane's code while looking at another's output. It fails green.
#
# Each worktree gets a slot (0..15) from a stable hash of its absolute path;
# the port is `base + slot * 100`. The main checkout is always slot 0, so its
# port stays exactly 4177 and nothing changes for anyone not using worktrees.
#
# A worktree's own prior claim (recorded in its `.dev-port`) wins over a fresh
# hash, so removing an unrelated sibling cannot silently move a surviving
# worktree to a different port between two runs.
#
# Here the collision is not just lane-vs-lane: the mac runs `nextup serve` on
# 4177 permanently as the LaunchAgent dev.hansenexus.nextup-serve (verified
# holding the port on 2026-09-09), so a lane using the default would fight the
# machine's own long-running server. Slot 0 still resolves 4177 because the main
# checkout is not where lanes run.
#
# Scope: isolates lanes of THIS repo from each other, not across repos.
#
#   scripts/dev-port.sh          # bare port, for `--port $(…)`
#   scripts/dev-port.sh --url    # http://localhost:<port>
set -euo pipefail

BASE=4177
MAX_SLOTS=16
STRIDE=100

root="$(git rev-parse --show-toplevel)"

read_slot() {  # $1 = worktree toplevel
  local v
  v="$(cat "$1/.dev-port" 2>/dev/null || true)"
  case "$v" in
    ''|*[!0-9]*) return 1 ;;
    *) [ "$v" -lt "$MAX_SLOTS" ] && printf '%s' "$v" || return 1 ;;
  esac
}

if [ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ]; then
  slot=0                                   # main checkout
else
  claimed=" 0 "
  while IFS= read -r line; do
    case "$line" in worktree\ *) ;; *) continue ;; esac
    top="${line#worktree }"
    [ "$top" = "$root" ] && continue
    s="$(read_slot "$top" || true)"
    [ -n "$s" ] && claimed="$claimed$s "
  done < <(git worktree list --porcelain)

  own="$(read_slot "$root" || true)"
  if [ -n "$own" ] && [ "$own" -gt 0 ] && [[ "$claimed" != *" $own "* ]]; then
    slot="$own"
  else
    start="$(printf '%s' "$root" | cksum | awk -v m="$MAX_SLOTS" '{print $1 % m}')"
    slot=""
    for i in $(seq 0 $((MAX_SLOTS - 1))); do
      cand=$(((start + i) % MAX_SLOTS))
      if [[ "$claimed" != *" $cand "* ]]; then slot="$cand"; break; fi
    done
    if [ -z "$slot" ]; then
      echo "dev-port: all $MAX_SLOTS worktree slots are taken — remove an unused worktree" >&2
      exit 1
    fi
  fi
  printf '%s\n' "$slot" > "$root/.dev-port"
fi

port=$((BASE + slot * STRIDE))
if [ "${1:-}" = "--url" ]; then printf 'http://localhost:%s\n' "$port"; else printf '%s\n' "$port"; fi
