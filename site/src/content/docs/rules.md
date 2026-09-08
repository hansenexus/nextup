---
title: The three rules
description: Phases carry time, status is derived, and a date needs a source.
---

Everything in the schema follows from three decisions. They are what make a
roadmap.yaml stay honest after the first month.

## 1. Phases carry time, items point at a phase

`phases` is an ORDERED list. A phase may name a quarter or a half
(`target: 2026-Q4`, `target: 2027-H1`) and nothing finer — the schema has no
day-date field on a phase or an item, and `validate` rejects one. An item says
which phase it belongs to, and `meta.current_phase` is the single pointer
from which every horizon is derived:

| item's phase vs. current | horizon |
|---|---|
| earlier | `carry-over` (shown as *now* in public) |
| the same | `now` |
| the next one | `next` |
| later | `later` |
| item is done | `shipped` |

Nobody writes `now`, `next` or `later`. Moving `current_phase` forward moves
the whole roadmap.

## 2. Status is derived once anything is linked

An item with linked issues gets its status from them, in this order, first
match wins:

1. `dropped` (manual, always allowed)
2. nothing linked, nothing dispatched → the manual `status:`, else `proposed`
3. any open issue labelled in-progress, or worked on a live lane → `in-progress`
4. open issues and every one of them labelled blocked → `blocked`
5. open issues → `planned`
6. tasks still undispatched → `in-progress` if anything closed, else `planned`
7. a mechanics wave referenced and not all settled → `in-progress`
8. otherwise → `done`

Write `status:` only on items with no issues: `proposed` or `planned` for what
has not started, `done` for what shipped before the roadmap existed — and say
`since:` when. A manual status on a linked item is a validation error, not a
preference. Details in [Status rollup](/status/).

## 3. A date needs a source

Only milestones carry day-dates, and only with a `source`:

```yaml
milestones:
  - id: p1-playtest
    title: First external playtest
    phase: P1
    status: planned
    date: 2026-12-15
    source: { kind: decision, ref: dec_2026-09-01_playtest, by: lennard, at: 2026-09-01 }
```

`kind` is one of `decision`, `commitment`, `contract`, `release`, `user`. An
undated milestone renders as a draft. A computed date is not a date: nextup
never turns "P1 is ~2 weeks" into a day.
