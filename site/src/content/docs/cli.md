---
title: CLI
description: Every command, flag and exit code.
---

```
nextup — roadmaps as a committed roadmap.yaml

commands
  init       scaffold roadmap.yaml (+ --pages workflow)
  validate   check the file(s); --live also checks issue links on GitHub
  status     roll status up from GitHub issues (table; --json)
  next       what is dispatchable now
  dispatch   open issues for an item's tasks (dry run; --apply to create)
  build      write roadmap.public.json / roadmap.internal.json (+ --site)
  serve      loopback dev server for the internal view (--static <dir> to serve a build)
  mcp        read-only MCP server on stdio

flags
  --file f            one roadmap file (default: located from cwd, all of them)
  --no-github         do not contact GitHub; output is marked stale
  --fleet-state p     enrich with fleetd lanes (~/.claude/fleet/state.json)
  --json              machine output
  --audience a        public | internal (build)
  --out dir           output directory (build; default dist/roadmap)
  --site              also write index.html + the web component bundle (build)
  --check             exit 1 when existing output differs (build)
  --estate cfg        build every repo listed in an estate yaml via the GitHub API
  --apply             dispatch for real
  --env e             fleet-<e> label on dispatched issues
  --auto-merge        add auto-merge-ok (only when the user grants it)
  --force-frontier    dispatch even when depends_on is not done

exit codes: 0 ok · 1 error/drift · 2 usage · 3 github unavailable · 4 refused
```

## Locating the file

Without `--file`, nextup walks up from the current directory. A
`nextup.config.yaml` wins over a nearer `roadmap.yaml`, so inside a monorepo
app you still get the whole set; `--file` narrows to one.

## Tokens

`NEXTUP_GITHUB_TOKEN`, then `GH_TOKEN`, then `GITHUB_TOKEN`, then whatever
`gh auth token` prints (set `NEXTUP_NO_GH=1` to skip that). Read-only
commands degrade to `stale: true` without a token; `dispatch --apply` and
`validate --live` refuse (exit `3`).

## build

| | |
|---|---|
| `--audience public` | the whitelist projection; refuses roadmaps with `meta.public: false` (exit `4`) |
| `--audience internal` | everything, issue links included; refuses an `--out` named `pages`, `public`, `gh-pages` or `docs` |
| `--site` | adds `index.html`, the web component bundle and `.nojekyll` |
| `--check` | compares against what is already in `--out`, exit `1` on drift — a CI guard for committed output |
| `--estate cfg` | reads roadmaps straight from GitHub for every repo the yaml lists; needs a token |

Output layout: a roadmap found on its own writes `roadmap.public.json` flat.
Roadmaps a config or an estate lists write `<project>/roadmap.public.json`
each — even when there is one — plus an `index.json` the static page reads.

## serve

Binds `127.0.0.1` only, no flag to change that. `nextup serve` watches the
roadmap and re-renders the internal view; `nextup serve --static dir` serves
a finished build. Share it by putting a tailnet or reverse-proxy forward in
front of it.
