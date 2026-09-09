---
title: Validation rules
description: What validate checks, which findings fail the build and which only warn.
---

`nextup validate` is offline and exits `1` on any error. Errors are things a
build must not ship; warnings are things a reviewer should see in the PR.
Every finding carries its rule id, a path into the file and a message:

```
roadmap.yaml: error V7 items[3].summary: a public item needs a summary
roadmap.yaml: warning V5 items[5].depends_on[0]: depends on "p2-staff" which is scheduled later (P2 > P1)
```

| rule | checks | level |
|---|---|---|
| V1 | the file parses and matches the schema (strict: unknown keys fail) | error |
| V2 | `meta.current_phase`, every `items[].phase` and `milestones[].phase` name an existing phase | error |
| V3 | ids are unique — items and aliases share one namespace; phases; milestones; tasks within an item | error |
| V4 | `depends_on`, `blocked_by` and `milestones[].items` resolve; no self-dependency; both graphs are acyclic | error |
| V5 | an item depending on an item scheduled in a later phase | warning |
| V6 | a dated milestone has a `source`; `planned`/`reached` have a date; `reached` has `reached_at`; `dropped` has a `reason` | error |
| V7 | a public item has a `summary`; public text that looks like it leaks internals (`#123`, `@handle`, `status:`) | error / warning |
| V8 | every declared locale has text for public titles and summaries | warning |
| V9 | a manual `status:` only where nothing is linked, and only with `since`; `dropped` needs `reason` | error |
| V10 | `clients:` is empty — the client tier does not exist in schema 1 | error |
| V11 | every task has at least one non-empty acceptance criterion and one verification command | error |
| V12 | `meta.updated` and `reached_at` are not in the future | error |
| V13 | a phase with no items | warning |
| V14 | `mechanics_wave` references need `meta.mechanics_waves` and the wave file must exist | error |
| V15 | an item link that cannot be resolved against `meta.repo` (climbs out of the repo, query-only) — it is dropped from the projections | warning |

`--live` adds three network checks: every linked issue number exists,
markers on `roadmap`-labelled issues resolve to an item, and a manual status
is not sitting on an item that has issues on GitHub.

## In CI

```yaml
- run: npx --yes @hansenexus/nextup@^0.1 validate
```

is the whole gate a roadmap change needs. Run it on every pull request that
touches the file; the public build and the rollup are downstream of it.
