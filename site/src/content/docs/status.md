---
title: Status rollup
description: How one status per item is derived from issues, labels, lanes and wave files.
---

`nextup status` fetches the repo's issues (open and closed), links them to
items, and reduces each item to one status. It is a pure function over four
inputs — the roadmap, the issues, optional lane state, optional mechanics
wave files — so the CLI, the MCP server and `build` all agree.

## Linking

An issue belongs to an item when

- its number is in the item's `issues:` list, or
- it carries the `roadmap` label and its body has a marker line
  `Roadmap-item: <file>#<id-or-alias>` (dispatch writes these; you can too).

A `Roadmap-task: <file>#<item>/<task>` marker additionally links the issue to
one task, which is how `next` knows a task was dispatched.

In a monorepo, only issues carrying `meta.scope.label` are considered for
that roadmap.

## Closed

An issue is closed when GitHub says `closed` OR it carries one of
`meta.labels.done`. A board that closes by column and a repo that closes by
merge both count.

## The rules

First match wins:

| # | condition | status |
|---|---|---|
| 1 | manual `status: dropped` | `dropped` |
| 2 | nothing linked, no task dispatched | manual `status:`, else `proposed` |
| 3 | an open issue carries an `in_progress` label, or is on a live lane | `in-progress` |
| 4 | open issues, and every one carries a `blocked` label | `blocked` |
| 5 | open issues | `planned` |
| 6 | tasks not yet dispatched | `in-progress` if anything closed, else `planned` |
| 7 | `mechanics_wave` set and not every verification settled | `in-progress` |
| 8 | otherwise | `done` |

Each status comes with a one-line reason (`#42 in progress (2 open, 3
closed)`), which the table prints and the internal projection carries.

## Horizons

From `meta.current_phase` and the ordered phases: `shipped` when done, else
`carry-over` / `now` / `next` / `later` by distance. Phases get `done` /
`now` / `next` / `later` the same way, plus `progress: { done, total }` over
their non-dropped items.

## Warnings and orphans

- a manual `status:` on an item that has issues — ignored, warned about
  (`validate` flags it as an error)
- `done` declared on an item whose wave is not all green
- an item referencing a wave that could not be loaded
- **orphans**: issues labelled `roadmap` whose marker points at no item (or at
  nothing) — drift between the file and the tracker, printed with
  `status --orphans` and carried in the internal projection. nextup never
  closes them.

## Lanes

`--fleet-state path` reads a lane daemon's state file (schema 1: lanes with
`repo`, `issue`, `runtime`, `phase`). An open issue on a lane counts as in
progress even without the label, and the internal projection shows the lane
next to the issue.

## Stale

Without a token, or when GitHub is unreachable, the rollup still runs on what
it has and sets `stale: true` with a reason. Every projection carries the
flag; the components render a *Stand veraltet* badge. Nothing pretends.
