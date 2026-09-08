---
title: Monorepos and estates
description: Several roadmaps in one repo, and several repos in one page.
---

## One repo, several roadmaps

A `nextup.config.yaml` at the repo root lists them:

```yaml
roadmaps: [roadmap.yaml, "apps/*/roadmap.yaml"]
```

Every command then walks all of them; `--file apps/alpha/roadmap.yaml`
narrows. The config wins over a nearer `roadmap.yaml`, so running from inside
`apps/alpha` still sees the set.

Each app's roadmap carries `meta.scope.label` (say `app/alpha`), and only
issues carrying that label are attributed to it — the repo's other issues
neither link nor show up as orphans.

`build` writes one directory per project, `<out>/<project>/roadmap.public.json`,
and an `index.json` listing them. It nests even when the config lists a
single roadmap: a site reading that URL must not have it move the day a
second app adds a roadmap.

## Several repos, one page

An estate file lists repos; `build --estate` fetches every roadmap through the
GitHub API — no checkouts — and writes the same per-project layout:

```yaml
repos:
  - repo: hansenexus/dev-empire
    files: [roadmap.yaml]
  - repo: hansenexus/hn-monorepo
    files: [apps/lexilink-next/roadmap.yaml]
    ref: feat/roadmap          # optional: a branch other than the default
  - repo: hansenexus/new-campus
```

```bash
npx @hansenexus/nextup build --audience internal --estate estate.yaml \
  --fleet-state ~/.claude/fleet/state.json --site --out ~/.local/share/nextup/site
npx @hansenexus/nextup serve --static ~/.local/share/nextup/site --port 4177
```

That pair, on a timer, is an internal roadmap page for a whole organisation:
issue links, lanes, orphans and warnings included, served on loopback and
shared over a private network. The `--fleet-state` file is optional
enrichment from a lane daemon; without it, lanes come from labels only.

For a PUBLIC aggregate do not use `--estate`: publish each repo's
`roadmap.public.json` (see [GitHub Pages](/pages/)) and have the aggregating
site fetch those URLs with `loadPublicRoadmap({ url })`.
