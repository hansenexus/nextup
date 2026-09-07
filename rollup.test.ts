import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frontier } from "./frontier";
import { parseRoadmap } from "./load";
import { horizonFor, linkIssues, rollup } from "./rollup";
import type { IssueSnapshot, Roadmap } from "./types";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const roadmap = (() => {
  const p = parseRoadmap(
    readFileSync(path.join(HERE, "examples", "dev-empire", "roadmap.yaml"), "utf8")
  );
  if (!p.ok) throw new Error("fixture roadmap invalid");
  return p.value;
})();
const issues = JSON.parse(
  readFileSync(path.join(HERE, "fixtures", "github", "dev-empire-issues.json"), "utf8")
) as IssueSnapshot[];

const roll = rollup({
  roadmap,
  file: "roadmap.yaml",
  issues,
  now: new Date("2026-09-07T12:00:00Z"),
});

describe("rollup — dev-empire fixture", () => {
  it("hand-linked closed issues → done", () => {
    expect(roll.items["p0-simcore"]?.status).toBe("done");
    expect(roll.items["p0-ci"]?.status).toBe("done");
  });
  it("single open blocked issue → blocked", () => {
    expect(roll.items["p0-ios-spike"]?.status).toBe("blocked");
  });
  it("marker-linked task in progress → in-progress, undispatched task counted", () => {
    const r = roll.items["p1-garage-loop"];
    expect(r?.status).toBe("in-progress");
    expect(r?.tasks.find((t) => t.id === "job-board")?.dispatched).toBe(40);
    expect(r?.tasks.find((t) => t.id === "build-step")?.dispatched).toBe(41);
    expect(r?.tasks.find((t) => t.id === "payout")?.dispatched).toBeNull();
    // the pull request carrying a marker is ignored
    expect(r?.issues.map((i) => i.number)).not.toContain(60);
  });
  it("mixed open issues with one in progress → in-progress", () => {
    expect(roll.items["p1-art-drop"]?.status).toBe("in-progress");
  });
  it("nothing linked → manual status or proposed", () => {
    expect(roll.items["p2-second-vertical"]?.status).toBe("proposed");
    expect(roll.items["p3-store"]?.status).toBe("proposed");
  });
  it("dropped stays dropped", () => {
    expect(roll.items["p0-dropped-idea"]?.status).toBe("dropped");
  });
  it("horizons derive from the current phase", () => {
    expect(roll.items["p0-ios-spike"]?.horizon).toBe("carry-over");
    expect(roll.items["p0-simcore"]?.horizon).toBe("shipped");
    expect(roll.items["p1-garage-loop"]?.horizon).toBe("now");
    expect(roll.items["p2-second-vertical"]?.horizon).toBe("next");
    expect(roll.items["p3-store"]?.horizon).toBe("later");
    expect(roll.phases.P0?.horizon).toBe("done");
    expect(roll.phases.P1?.horizon).toBe("now");
  });
  it("phase progress excludes dropped items", () => {
    expect(roll.phases.P0?.progress).toEqual({ done: 2, total: 3 });
  });
  it("reports orphans: roadmap label without marker, marker to unknown item", () => {
    expect(roll.orphans.map((o) => [o.number, o.kind])).toEqual(
      expect.arrayContaining([
        [50, "unlinked"],
        [51, "unknown-marker"],
      ])
    );
  });
  it("is not stale when issues were provided", () => {
    expect(roll.stale).toBe(false);
  });
});

describe("rollup — branches", () => {
  const mk = (extra: string): Roadmap => {
    const p = parseRoadmap(`schema: 1
meta: { project: x, repo: o/r, title: X, version: 1, updated: 2026-09-01, current_phase: P0 }
phases: [{ id: P0, title: A }]
items:
  - id: a
    title: A
    phase: P0
${extra}
`);
    if (!p.ok) throw new Error(p.errors.map((e) => e.message).join());
    return p.value;
  };
  const issue = (
    n: number,
    state: "open" | "closed",
    labels: string[] = [],
    body = ""
  ): IssueSnapshot => ({
    number: n,
    title: `#${n}`,
    state,
    labels,
    body,
    url: `u/${n}`,
  });

  it("open issues, none started → planned", () => {
    const r = rollup({
      roadmap: mk("    issues: [1]"),
      file: "roadmap.yaml",
      issues: [issue(1, "open")],
    });
    expect(r.items.a?.status).toBe("planned");
  });
  it("label from labels.done counts as closed", () => {
    const r = rollup({
      roadmap: mk("    issues: [1]"),
      file: "roadmap.yaml",
      issues: [issue(1, "open", ["status/done"])],
    });
    expect(r.items.a?.status).toBe("done");
  });
  it("a fleet lane on an open issue → in-progress even without a label", () => {
    const r = rollup({
      roadmap: mk("    issues: [1]"),
      file: "roadmap.yaml",
      issues: [issue(1, "open")],
      lanes: [{ issue: 1 }],
    });
    expect(r.items.a?.status).toBe("in-progress");
  });
  it("all issues closed but wave not settled → in-progress with a warning", () => {
    const r = rollup({
      roadmap: mk("    issues: [1]\n    mechanics_wave: w1"),
      file: "roadmap.yaml",
      issues: [issue(1, "closed")],
      waves: { w1: { wave: "w1", status: "open", total: 4, passing: 3, settled: 3 } },
    });
    expect(r.items.a?.status).toBe("in-progress");
    expect(r.items.a?.warnings[0]).toMatch(/wave w1 not green/);
  });
  it("all issues closed and wave settled → done", () => {
    const r = rollup({
      roadmap: mk("    issues: [1]\n    mechanics_wave: w1"),
      file: "roadmap.yaml",
      issues: [issue(1, "closed")],
      waves: { w1: { wave: "w1", status: "closed", total: 4, passing: 3, settled: 4 } },
    });
    expect(r.items.a?.status).toBe("done");
  });
  it("undispatched tasks with closed issues → in-progress; with none → planned", () => {
    const tasks = "    tasks:\n      - { id: t1, title: T, acceptance: [x], verify: [y] }";
    const r1 = rollup({
      roadmap: mk(`    issues: [1]\n${tasks}`),
      file: "roadmap.yaml",
      issues: [issue(1, "closed")],
    });
    expect(r1.items.a?.status).toBe("in-progress");
    const r0 = rollup({ roadmap: mk(tasks), file: "roadmap.yaml", issues: [] });
    expect(r0.items.a?.status).toBe("proposed");
  });
  it("manual status is ignored with a warning once anything is linked", () => {
    const r = rollup({
      roadmap: mk("    status: planned\n    since: 2026-09-01"),
      file: "roadmap.yaml",
      issues: [issue(7, "open", ["roadmap"], "Roadmap-item: roadmap.yaml#a")],
    });
    expect(r.items.a?.status).toBe("planned");
    expect(r.items.a?.warnings[0]).toMatch(/manual status/);
  });
  it("aliases resolve markers written against the old id", () => {
    const r = rollup({
      roadmap: mk("    aliases: [old-a]"),
      file: "roadmap.yaml",
      issues: [issue(7, "closed", ["roadmap"], "Roadmap-item: roadmap.yaml#old-a")],
    });
    expect(r.items.a?.status).toBe("done");
  });
  it("markers for another file are not ours", () => {
    const r = rollup({
      roadmap: mk(""),
      file: "roadmap.yaml",
      issues: [issue(7, "closed", ["roadmap"], "Roadmap-item: apps/other/roadmap.yaml#a")],
    });
    expect(r.items.a?.status).toBe("proposed");
  });
  it("scope label filters unlinked orphans in a monorepo", () => {
    const p = parseRoadmap(`schema: 1
meta: { project: x, repo: o/r, title: X, version: 1, updated: 2026-09-01, current_phase: P0, scope: { label: app/x } }
phases: [{ id: P0, title: A }]
items: [{ id: a, title: A, phase: P0 }]
`);
    if (!p.ok) throw new Error("parse");
    const { orphans } = linkIssues(p.value, "roadmap.yaml", [
      issue(1, "open", ["roadmap"]),
      issue(2, "open", ["roadmap", "app/x"]),
    ]);
    expect(orphans.map((o) => o.number)).toEqual([2]);
  });
  it("stale flag and reason pass through", () => {
    const r = rollup({
      roadmap: mk(""),
      file: "roadmap.yaml",
      issues: [],
      stale: { reason: "no-github-token" },
    });
    expect(r.stale).toBe(true);
    expect(r.staleReason).toBe("no-github-token");
  });
  it("horizonFor treats unknown phases as later", () => {
    expect(horizonFor("zz", "P0", ["P0"], "planned")).toBe("later");
  });
});

describe("frontier", () => {
  it("lists only current-phase (and carry-over) items with unmet deps and clear tasks", () => {
    const f = frontier(roadmap, roll, issues);
    const ids = f.map((x) => x.item.id);
    expect(ids).toContain("p1-garage-loop");
    expect(ids).toContain("p1-art-drop");
    expect(ids).toContain("p0-ios-spike"); // carry-over
    expect(ids).not.toContain("p2-second-vertical");
    const garage = f.find((x) => x.item.id === "p1-garage-loop");
    expect(garage?.unmetDependencies).toEqual([]);
    const payout = garage?.tasks.find((t) => t.task.id === "payout");
    // build-step (#41) is open → payout is not clear
    expect(payout?.clear).toBe(false);
    expect(payout?.blockedByIssues).toEqual([41]);
    // job-board and build-step already dispatched → not listed
    expect(garage?.tasks.map((t) => t.task.id)).toEqual(["payout"]);
  });
});
