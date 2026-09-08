# nextup

Roadmaps as a committed `roadmap.yaml`. One file per project says what you are
doing, in what order, and how far along it is. Status rolls up from GitHub
issues; tasks dispatch as issues a daemon can pick up; the same file projects to
an internal page, a public JSON feed, a React component and a web component.

```yaml
schema: 1
meta:
  project: dev-empire
  repo: hansenexus/dev-empire
  title: dev-empire
  version: 3
  updated: 2026-09-07
  public: false
  current_phase: P1
phases:
  - { id: P0, title: Bootstrap, goal: "Deterministic sim core, CI green." }
  - { id: P1, title: Vertical slice, goal: "One 20–30 minute loop.", target: 2026-Q4 }
items:
  - id: p1-garage-loop
    title: Garage loop
    summary: Take a job, build the thing, ship it, get paid.
    phase: P1
    visibility: public
    depends_on: [p0-simcore]
    tasks:
      - id: job-board
        title: Job board with three job archetypes
        acceptance: ["Three archetypes appear with pay, deadline and difficulty"]
        verify: ["dotnet test Tests/SimCore.Tests --filter JobBoard"]
milestones:
  - id: p1-playtest
    title: First external playtest
    phase: P1
    status: planned
    date: 2026-12-15
    source: { kind: decision, ref: dec_2026-09-01_playtest, by: lennard, at: 2026-09-01 }
```

## The three rules

1. **Phases carry time, items point at a phase.** A phase may name a quarter
   (`target: 2026-Q4`) and nothing finer. `now / next / later` is derived from
   `meta.current_phase`, never written.
2. **Status is derived once anything is linked.** Closed issues → done, an
   issue labelled in-progress → in progress, all open issues blocked → blocked.
   Write `status:` only on items with no issues: `proposed`/`planned` for what
   is not started, `done` for what shipped before the roadmap existed — and say
   `since:` when.
3. **A date needs a source.** Only milestones carry day-dates, and only with
   `source: { kind, by, at }`. Undated milestones render as drafts. A computed
   date is not a date.

## Commands

Run it with `npx @hansenexus/nextup <command>` (node ≥ 20) or
`bunx --bun @hansenexus/nextup <command>` (bun only, no node). Docs:
[nextup.hansenexus.dev](https://nextup.hansenexus.dev).

```
nextup init --pages                         scaffold roadmap.yaml (+ Pages workflow)
nextup validate [--live]                    check the file; --live checks issue links too
nextup status [--json] [--fleet-state p]    roll status up from GitHub
nextup next                                 what is dispatchable now
nextup dispatch <item> [--apply]            open issues for an item's tasks (dry run first)
nextup build --audience public --site       roadmap.public.json + static page
nextup build --audience internal --out d    roadmap.internal.json (refuses pages-like dirs)
nextup serve [--static dir]                 loopback dev server
nextup mcp                                  read-only MCP server (stdio)
```

Exit codes: `0` ok · `1` validation error or drift · `2` usage · `3` GitHub
unavailable · `4` refused precondition. Token: `NEXTUP_GITHUB_TOKEN`,
`GH_TOKEN`, `GITHUB_TOKEN`, then `gh auth token`. Without one, `build` still
runs and the output says `stale: true`.

## Dispatch

`nextup dispatch <item>` prints what it would create. `--apply` creates one
issue per task, in dependency order, with the body shape agents already read:
`## Description`, `## Acceptance Criteria` (checkboxes), `## Verification
commands`, `Blocked-by: #N` lines, and two marker lines that link the issue
back:

```
Roadmap-item: roadmap.yaml#p1-garage-loop
Roadmap-task: roadmap.yaml#p1-garage-loop/job-board
```

Tasks whose blockers are all closed get the `ready` label; the rest wait for
the frontier to reach them. Re-running creates nothing that already exists.
nextup never edits an existing issue and never writes into `roadmap.yaml`.

## Public sites

```ts
import { loadPublicRoadmap } from "@hansenexus/nextup";
import { Roadmap } from "@hansenexus/nextup/react";
import "@hansenexus/nextup/react/styles.css";

const data = await loadPublicRoadmap({ file: "roadmap.yaml", token: process.env.GITHUB_TOKEN });
// or: await loadPublicRoadmap({ url: "https://org.github.io/repo/roadmap.public.json" });
export default function Page() {
  return <Roadmap data={data} locale="de" view="phases" />;
}
```

Non-React pages: `<script src=".../nextup-roadmap.iife.js"></script>` and
`<nextup-roadmap src="./roadmap.public.json" lang="en"></nextup-roadmap>`.
Restyle with `--nextup-*` CSS variables.

The public projection is a whitelist: no issue numbers, owners, notes, lane
state or internal items ever leave. `meta.public: false` makes
`build --audience public` refuse outright.

## Monorepos

A `nextup.config.yaml` at the root lists the roadmaps:

```yaml
roadmaps: [roadmap.yaml, "apps/*/roadmap.yaml"]
```

Every command then walks all of them (`--file` narrows). Each app's roadmap
carries `meta.scope.label` (e.g. `app/alpha`) so issues are attributed to the
right one. `build` writes `<out>/<project>/roadmap.public.json` for every
roadmap a config lists — nested even when the list has one entry, so a URL a
site depends on does not move when the next app adds a roadmap — plus an
`index.json` the static page reads. A roadmap found on its own (`--file`, or
the nearest `roadmap.yaml`) writes flat.

## Development

```
bun install --frozen-lockfile
bun run lint && bun run typecheck && bun run test
bun run build          # dist/cli.js, dist/index.js, dist/react, dist/wc
bun run schema:gen     # regenerate schema/roadmap.schema.json
```

MIT © hansenexus GmbH
