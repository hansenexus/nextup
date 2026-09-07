# CLAUDE.md

Conventions for agents working in this repo. README is the product; this file
is what is not obvious from it, plus the parts that must not be "improved".

## Commands

```bash
bun install --frozen-lockfile   # bun ≥ 1.2; lockfile committed
bun run lint                    # biome check .
bun run typecheck               # three tsconfigs: core, ui-react, wc
bun run test                    # build:wc, then vitest (build.test.ts needs the wc bundle)
bun run build                   # dist/: cli + barrel (node), react, wc (+iife), .d.ts
bun run schema:gen              # schema/roadmap.schema.json — drift-tested
```

`lint`, `typecheck`, `test` are CI's `check` job. CI also packs the tarball and
drives `init → validate → build --site` through the INSTALLED cli, and starts
`dist/cli.js` under plain node. Anything Bun-only fails there.

## Layout

Flat at the root, one module per concern, tests beside as `<module>.test.ts`.
Three source trees have their own tsconfig because they need different libs:
`ui-react/` (React, `dist/react`), `wc/` (custom element, `dist/wc`), everything
else (node). The React source dir is NOT called `react/` on purpose — Bun and
tsc both resolved `import "react"` to it.

`index.ts` is the read-only barrel Next.js sites import. Keep `child_process`
out of it: token discovery lives in `token.ts`, which only `cli.ts` and
`build.ts` import.

Rendering is split so both renderers stay thin: `view-model.ts` decides WHAT to
show (grouping, locale fallback, wording, "vN · Stand <date>"), `render-html.ts`
turns that into an HTML string for the web component, `ui-react/index.tsx`
turns it into JSX. Add a field to the view model, then to both renderers.

## Things that must stay true

- **Public output is a whitelist.** `project.ts` names every field that may
  leave; `FORBIDDEN_PUBLIC_KEYS` is the tripwire and `project.test.ts` walks
  the output. A new schema field is internal until someone adds it to
  `toPublic` on purpose.
- **No day-dates outside milestones, and none without `source`.** The schema
  has no date field on phases or items; `target` is a quarter regex. Do not add
  one.
- **Status is derived once linked.** `rollup.ts` is a pure function; every
  branch has a fixture test. Manual `status:` on a linked item is a validation
  error, not a preference.
- **dispatch is dry-run by default** and creates only issues + the `roadmap`
  label. It never edits an existing issue, never removes a label, never writes
  yaml, never sets `auto-merge-ok` without `--auto-merge`, and puts `ready`
  only on tasks whose blockers are closed. The `Blocked-by:` regex is fleetd's,
  verbatim.
- **The MCP server has no write tool.** See the header of `mcp.ts`.
- **`serve` binds 127.0.0.1 only**, no flag. Internal projections are shared
  by putting a tailnet forward in front of it.
- **`build --audience internal` refuses `pages|public|gh-pages|docs` paths.**

## Adding a module

File + test + `exports` in `package.json` + the barrel (`index.ts`) if it is
read-only. Run `bun run build` — `tsconfig.build.json` lists the entry points
whose `.d.ts` ship.
