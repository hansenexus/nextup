---
title: Getting started
description: Put a roadmap.yaml in a repo, validate it, and get a status table out of GitHub.
---

nextup keeps a project's roadmap as one committed file, `roadmap.yaml`, and
derives everything else from it: what is now / next / later, how far each
phase is, which tasks an agent could pick up, and two projections — an
internal page with issue links and a public JSON feed with none of them.

## Install

Nothing to install for the CLI. It is a bundled Node build, so either of these
works from any repo:

```bash
npx @hansenexus/nextup <command>          # node ≥ 20
bunx --bun @hansenexus/nextup <command>   # bun only, no node on the box
```

Sites that render a roadmap add the package:

```bash
npm i @hansenexus/nextup     # or: bun add @hansenexus/nextup
```

## Scaffold

```bash
npx @hansenexus/nextup init
npx @hansenexus/nextup init --pages       # also writes .github/workflows/roadmap.yml
```

`init` writes a commented `roadmap.yaml` with one phase and one item, and with
`--pages` a workflow that validates the file on every change and publishes the
public projection to GitHub Pages. Every file is skip-if-exists (`--force` to
overwrite).

## Validate

```bash
npx @hansenexus/nextup validate
```

Offline, exit `1` on any error with the rule id (`V1`…`V14`) and the path.
`--live` also checks that every linked issue exists on GitHub. Put this in CI —
it is the whole gate a roadmap change needs.

## See status

```bash
npx @hansenexus/nextup status
npx @hansenexus/nextup next
```

`status` rolls the state of every linked issue up into one status per item and
prints a table; `next` lists what is dispatchable right now. Both need a
GitHub token: `NEXTUP_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, or the token
`gh auth token` returns. Without one they still run and mark the output
`stale`.

## Publish

```bash
npx @hansenexus/nextup build --audience public --site --out dist/public
```

writes `roadmap.public.json`, a static `index.html` that renders it, and the
web component bundle. `meta.public: true` in the file is the switch; without
it the public build refuses (exit `4`). See [Public sites](/sites/) and
[GitHub Pages](/pages/).
