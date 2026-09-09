import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRoadmap } from "./load";
import { findForbiddenKeys, toInternal, toPublic } from "./project";
import { rollup } from "./rollup";
import { publicRoadmapSchema } from "./schema";
import type { IssueSnapshot } from "./types";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const parsed = parseRoadmap(
  readFileSync(path.join(HERE, "examples", "dev-empire", "roadmap.yaml"), "utf8")
);
if (!parsed.ok) throw new Error("fixture");
const roadmap = parsed.value;
const issues = JSON.parse(
  readFileSync(path.join(HERE, "fixtures", "github", "dev-empire-issues.json"), "utf8")
) as IssueSnapshot[];
const roll = rollup({
  roadmap,
  file: "roadmap.yaml",
  issues,
  now: new Date("2026-09-07T12:00:00Z"),
});

describe("toPublic", () => {
  const pub = toPublic(roadmap, roll);

  it("validates against publicRoadmapSchema", () => {
    expect(publicRoadmapSchema.safeParse(pub).success).toBe(true);
  });
  it("contains no forbidden keys anywhere", () => {
    expect(findForbiddenKeys(pub)).toEqual([]);
  });
  it("drops internal items and phases with no public items", () => {
    const ids = pub.items.map((i) => i.id);
    expect(ids).not.toContain("p0-ios-spike");
    expect(ids).not.toContain("p3-store");
    expect(pub.phases.map((p) => p.id)).toEqual(["P0", "P1", "P2"]);
  });
  it("keeps dropped items so a reader sees 'removed' rather than a silent hole", () => {
    expect(pub.items.find((i) => i.id === "p0-dropped-idea")?.status).toBe("dropped");
  });
  it("shows blocked as in-progress by default", () => {
    // p0-ios-spike is internal; build a public blocked item to check the collapse
    const p2 = parseRoadmap(`schema: 1
meta: { project: x, repo: o/r, title: X, version: 1, updated: 2026-09-01, public: true, current_phase: P0 }
phases: [{ id: P0, title: A }]
items: [{ id: a, title: A, summary: S, phase: P0, visibility: public, issues: [1] }]
`);
    if (!p2.ok) throw new Error("parse");
    const r2 = rollup({
      roadmap: p2.value,
      file: "roadmap.yaml",
      issues: [
        { number: 1, title: "x", state: "open", labels: ["status:blocked"], body: "", url: "u" },
      ],
    });
    expect(r2.items.a?.status).toBe("blocked");
    expect(toPublic(p2.value, r2).items[0]?.status).toBe("in-progress");
  });
  it("only shows milestone dates when planned or reached, never on drafts", () => {
    const byId = Object.fromEntries(pub.milestones.map((m) => [m.id, m]));
    expect(byId["p1-exit"]?.date).toBeNull();
    expect(byId["p1-playtest"]?.date).toBe("2026-12-15");
    expect(byId["p0-exit"]?.reached_at).toBe("2026-08-30");
    expect(byId["p1-playtest"]?.source_kind).toBe("decision");
  });
  it("filters depends_on edges to public items only", () => {
    const p2 = parseRoadmap(`schema: 1
meta: { project: x, repo: o/r, title: X, version: 1, updated: 2026-09-01, public: true, current_phase: P0 }
phases: [{ id: P0, title: A }]
items:
  - { id: hidden, title: H, phase: P0 }
  - { id: shown, title: S, summary: S, phase: P0, visibility: public, depends_on: [hidden] }
`);
    if (!p2.ok) throw new Error("parse");
    const r2 = rollup({ roadmap: p2.value, file: "roadmap.yaml", issues: [] });
    expect(toPublic(p2.value, r2).items[0]?.depends_on).toEqual([]);
  });
  it("resolves relative item links against meta.repo at HEAD; absolute ones pass through", () => {
    // examples/dev-empire links `docs/PLAN.md#phasing` — the exact case new-campus hit.
    const simcore = pub.items.find((i) => i.id === "p0-simcore");
    expect(simcore?.links).toEqual([
      {
        title: "PLAN.md §Phasing",
        url: "https://github.com/example/dev-empire/blob/HEAD/docs/PLAN.md#phasing",
      },
    ]);
    const p2 = parseRoadmap(`schema: 1
meta: { project: x, repo: o/r, title: X, version: 1, updated: 2026-09-01, public: true, current_phase: P0 }
phases: [{ id: P0, title: A }]
items:
  - id: a
    title: A
    summary: S
    phase: P0
    visibility: public
    links:
      - { title: site, url: "https://example.com/x" }
      - { title: mail, url: "mailto:a@b" }
      - { title: anchor, url: "#top" }
      - { title: doc, url: ./docs/x.md }
      - { title: escapes, url: ../other/x.md }
`);
    if (!p2.ok) throw new Error("parse");
    const r2 = rollup({ roadmap: p2.value, file: "roadmap.yaml", issues: [] });
    const links = toPublic(p2.value, r2).items[0]?.links.map((l) => l.url);
    expect(links).toEqual([
      "https://example.com/x",
      "mailto:a@b",
      "#top",
      "https://github.com/o/r/blob/HEAD/docs/x.md",
    ]);
    // Every link a projection ships is one a browser can follow from any origin.
    expect(findForbiddenKeys(toPublic(p2.value, r2))).toEqual([]);
  });
  it("an internal phase hides its public items", () => {
    const p2 = parseRoadmap(`schema: 1
meta: { project: x, repo: o/r, title: X, version: 1, updated: 2026-09-01, public: true, current_phase: P0 }
phases: [{ id: P0, title: A, visibility: internal }]
items: [{ id: a, title: A, summary: S, phase: P0, visibility: public }]
`);
    if (!p2.ok) throw new Error("parse");
    const pubx = toPublic(
      p2.value,
      rollup({ roadmap: p2.value, file: "roadmap.yaml", issues: [] })
    );
    expect(pubx.items).toEqual([]);
    expect(pubx.phases).toEqual([]);
  });
});

describe("toInternal", () => {
  const internal = toInternal(roadmap, roll, "roadmap.yaml");
  it("carries issues, tasks, lanes and orphans", () => {
    const garage = internal.items.find((i) => i.id === "p1-garage-loop");
    expect(garage?.linked_issues.map((i) => i.number)).toEqual([40, 41]);
    expect(garage?.task_rollup.map((t) => t.dispatched)).toEqual([40, 41, null]);
    expect(internal.orphans.length).toBe(2);
    expect(internal.audience).toBe("internal");
  });
  it("would be caught by the forbidden-key walk (sanity check of the guard itself)", () => {
    expect(findForbiddenKeys(internal).length).toBeGreaterThan(0);
  });
  it("resolves item links the same way the public projection does", () => {
    // The internal page is served from a tailnet forward, not from the repo:
    // a relative href is just as broken there.
    const simcore = internal.items.find((i) => i.id === "p0-simcore");
    expect(simcore?.links.map((l) => l.url)).toEqual([
      "https://github.com/example/dev-empire/blob/HEAD/docs/PLAN.md#phasing",
    ]);
  });
});
