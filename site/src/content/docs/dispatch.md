---
title: Dispatch
description: Turn an item's tasks into GitHub issues an agent can pick up.
---

```bash
npx @hansenexus/nextup dispatch p1-garage-loop            # dry run: prints the plan
npx @hansenexus/nextup dispatch p1-garage-loop --apply    # creates the issues
```

Dry run is the default. `--apply` creates one issue per task, in dependency
order, and nothing else: nextup never edits an existing issue, never removes
a label, never writes into `roadmap.yaml`.

## What an issue looks like

Title `[<item-id>] <task title>`. Body:

```markdown
## Description
…task.description…

## Acceptance Criteria
- [ ] Three archetypes appear with pay, deadline and difficulty

## Verification commands
- `dotnet test Tests/SimCore.Tests --filter JobBoard`

## Dependencies
Blocked-by: #42

Roadmap-item: roadmap.yaml#p1-garage-loop
Roadmap-task: roadmap.yaml#p1-garage-loop/job-board
```

The two marker lines are the link back. `status` finds an item's issues by
them (plus the `issues:` you link by hand), and an issue whose marker points
at no item shows up as an orphan.

## Labels

- `roadmap` — the one label nextup creates if missing. Everything else must
  already exist in the repo (`ready` in particular; exit `4` says so).
- `ready` — only on tasks whose blockers are all closed. The rest wait for
  the frontier to reach them; re-running dispatch later puts `ready` on
  nothing either, because it never edits — close the blocker and the daemon
  that watches `ready` is your business, or link the follow-up by hand.
- `task.labels` — copied as given.
- `fleet-<env>` — from `--env`, else `task.fleet_env`, else `meta.fleet_env`.
- `interactive` — when the task says so.
- `auto-merge-ok` — only with `--auto-merge`.

## Preconditions (exit 4)

- the item is `dropped`
- the item has no tasks
- a task lacks `acceptance` or `verify`
- `depends_on` names an item that is not done (`--force-frontier` overrides)
- the repo lacks a label the plan needs

## Idempotent

Before creating anything, dispatch lists the repo's `roadmap`-labelled issues
and reads their `Roadmap-task:` markers. Tasks that already have an issue are
skipped; running it twice creates nothing the second time.

## Blocked-by

`Blocked-by: #N` lines follow the convention lane daemons already parse
(`^[ \t>*-]*blocked[- ]by:\s*#(\d+)`), so a dispatched issue is blocked in the
same way a hand-written one is.
