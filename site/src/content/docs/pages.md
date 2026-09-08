---
title: GitHub Pages
description: Publish roadmap.public.json and a static page from CI.
---

`nextup init --pages` writes `.github/workflows/roadmap.yml`. It validates the
file on every change and publishes the public projection to GitHub Pages on
pushes to the default branch, every six hours (status lives in issues, not in
commits) and on demand:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - name: Validate
        run: bunx @hansenexus/nextup@^0.1 validate
      - name: Build public projection
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: bunx @hansenexus/nextup@^0.1 build --audience public --site --out dist/public
      - uses: actions/upload-pages-artifact@v5
        with:
          path: dist/public

  deploy:
    if: github.event_name != 'pull_request'
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - id: deploy
        uses: actions/deploy-pages@v5
```

`npx --yes @hansenexus/nextup@^0.1` with `actions/setup-node` works just as
well; the bundled CLI needs node ≥ 20 or bun.

Enable Pages for the repo once:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

The projection then lives at
`https://<owner>.github.io/<repo>/roadmap.public.json`, next to a page that
renders it. Put that URL in `meta.public_url` so aggregators can find it.

## Private repos

On a plan where Pages works for private repos, the Pages site is still
world-readable. That is right for the public projection and wrong for
anything else — which is why only `--audience public` belongs in this
workflow, why `meta.public: true` is an explicit switch, and why
`build --audience internal` refuses an output directory named `pages`,
`public`, `gh-pages` or `docs`.

## Monorepos

Run the same steps from the repo root without `--file`; `build` writes
`<project>/roadmap.public.json` for every roadmap the config lists (see
[Monorepos](/monorepos/)). From a repo whose `package.json` carries npm
`overrides`, use `bunx --bun @hansenexus/nextup@^0.1` instead of `npx` —
npm applies those overrides to the ad-hoc install and refuses.
