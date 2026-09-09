---
title: roadmap.yaml
description: Every field of the file, with the defaults the schema fills in.
---

The file is validated against a strict schema (unknown keys are errors). The
JSON Schema is published at
`https://nextup.hansenexus.dev/schema/roadmap.schema.json` — the scaffolded
file points at it in a `yaml-language-server` comment, so editors complete
and check as you type.

```yaml
schema: 1
meta: { … }
phases: [ … ]
items: [ … ]
milestones: [ … ]
```

## meta

| field | default | meaning |
|---|---|---|
| `project` | — | lowercase slug, unique across everything you aggregate |
| `repo` | — | `owner/name` on GitHub |
| `title` | — | string or `{ en: …, de: … }` |
| `locales` | `[en]` | first entry is the fallback locale |
| `version` | — | monotonic; bump on any change a public reader could notice |
| `updated` | — | `YYYY-MM-DD`, not in the future |
| `public` | `false` | `false` refuses to emit a public projection at all |
| `public_url` | `null` | where `roadmap.public.json` is served, for aggregators |
| `current_phase` | — | the phase id horizons derive from |
| `labels` | see below | how this repo spells task state |
| `fleet_env` | `null` | default `fleet-<env>` label on dispatched issues |
| `mechanics_waves` | `null` | directory of mechanics wave files, repo-relative |
| `scope.label` | `null` | monorepo: only issues carrying this label belong here |
| `presentation.show_blocked_as` | `in-progress` | public readers never see *blocked* |

`labels` defaults cover the two spellings in common use, `status:*` and
`status/*`:

```yaml
labels:
  in_progress: [status:in-progress, status/in-progress, status:review, status/review]
  blocked: [status:blocked, status:needs-human, status/blocked, blocked]
  done: [status/done]
  ready: [ready, status/ready]
```

An issue counts as closed when GitHub says so OR when it carries a `done`
label, so a board that closes by column and a repo that closes by merge both
work.

## phases

Ordered. Each phase:

| field | default | |
|---|---|---|
| `id` | — | `P0`, `w3`, … |
| `title` | — | localized string |
| `goal`, `gets_you` | — | one sentence each, optional |
| `target` | — | `2026`, `2026-Q4` or `2027-H1`; never a day |
| `visibility` | `public` | `internal` hides the phase AND every item in it |

## items

| field | default | |
|---|---|---|
| `id` | — | stable; rename through `aliases` |
| `aliases` | `[]` | old ids that still resolve in issue markers |
| `title` | — | localized |
| `summary` | — | localized; REQUIRED when `visibility: public` |
| `description` | — | internal prose |
| `phase` | — | a phase id |
| `kind` | `epic` | `theme`, `epic` or `wave` |
| `area` | — | free grouping: `must-land`, `track-a`, a domain |
| `visibility` | `internal` | `public` puts it in the public projection |
| `depends_on` | `[]` | item ids; acyclic |
| `issues` | `[]` | issue numbers linked by hand |
| `tasks` | `[]` | what `dispatch` turns into issues |
| `status` | — | manual: `proposed`, `planned`, `done`, `dropped`; only while nothing is linked |
| `since` | — | required with a manual status |
| `reason` | — | required with `dropped` |
| `mechanics_wave` | `null` | `done` additionally needs this wave all green |
| `owners`, `notes` | | internal |
| `links` | `[]` | `{ title, url }` pairs; ship in both projections, resolved against `meta.repo` (below) |
| `clients` | `[]` | reserved for a client tier; must stay empty in schema 1 |

### tasks

```yaml
tasks:
  - id: job-board
    title: Job board with three job archetypes
    description: optional prose for the issue body
    acceptance: ["Three archetypes appear with pay, deadline and difficulty"]
    verify: ["dotnet test Tests/SimCore.Tests --filter JobBoard"]
    blocked_by: [prng]            # task ids here, or other-item/task-id
    labels: [phase-1]
    fleet_env: null
    interactive: false
```

`acceptance` and `verify` each need at least one entry: an issue without a
way to check it is not something an agent should pick up.

### links

```yaml
links:
  - { title: Design note, url: docs/design/blueprint-module.md }
  - { title: Tracking board, url: "https://github.com/orgs/acme/projects/4" }
```

A `url` is written from the repository's point of view, but the projection is
rendered on somebody else's origin — a consumer site, a Pages build — where a
relative href would resolve against the wrong host. So `build` (and every
other path that writes a projection) resolves links before they leave:

| `url` in the file | in the projection |
|---|---|
| `docs/x.md`, `./docs/x.md`, `/docs/x.md`, `docs/x.md#section` | `https://github.com/<meta.repo>/blob/HEAD/docs/x.md` (fragment kept) |
| `https://…`, `//cdn.…`, `mailto:…`, `tel:…` | untouched |
| `#section` | untouched |
| `../outside-the-repo`, `?query-only` | dropped; `validate` warns (V15) |

`HEAD` rather than a branch name on purpose: GitHub resolves it to the
default branch, so the output is the same with or without a token and does
not drift when `master` becomes `main`. The React component and the web
component render whatever the projection carries, so a relative href never
reaches a page.

## milestones

| field | default | |
|---|---|---|
| `id`, `title`, `summary` | | |
| `phase` | — | a phase id |
| `items` | `[]` | when all are done the milestone may be `reached` |
| `status` | `draft` | `draft`, `planned`, `reached`, `dropped` |
| `date` | `null` | a day; present ⇒ `source` present and status `planned` or `reached` |
| `source` | `null` | `{ kind, ref?, by, at }` |
| `reached_at` | `null` | required with `reached` |
| `reason` | — | required with `dropped` |
| `visibility` | `public` | |

## Localized text

Any `title`, `summary`, `goal` or `gets_you` is either a plain string or a map
keyed by locale. The public projection ships the map as-is; the components
pick the requested locale and fall back to `meta.locales[0]`. `validate` warns
when a public item lacks a locale the file declares.
