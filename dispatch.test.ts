import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyDispatch, DispatchRefused, planDispatch, renderPlan } from "./dispatch";
import type { CreateIssueInput, GitHubClient } from "./github";
import { parseRoadmap } from "./load";
import { parseBlockedBy, parseMarkers } from "./markers";
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
const LABELS = [
  "ready",
  "roadmap",
  "phase-0",
  "phase-1",
  "art",
  "blocked",
  "fleet-local",
  "interactive",
  "auto-merge-ok",
  "status:in-progress",
];

/** Records what would hit GitHub. Numbers start at 100. */
function fakeClient(): GitHubClient & {
  created: Array<CreateIssueInput & { number: number }>;
  labelsCreated: string[];
} {
  const created: Array<CreateIssueInput & { number: number }> = [];
  const labelsCreated: string[] = [];
  let next = 100;
  return {
    created,
    labelsCreated,
    async listIssues() {
      return issues;
    },
    async getIssue() {
      return null;
    },
    async listLabels() {
      return LABELS;
    },
    async createLabel(_repo, name) {
      labelsCreated.push(name);
    },
    async createIssue(_repo, input) {
      const number = next++;
      created.push({ ...input, number });
      return { number, url: `https://github.com/example/dev-empire/issues/${number}` };
    },
    async getFileContent() {
      return null;
    },
  };
}

describe("planDispatch", () => {
  it("skips tasks that already have an issue and plans the rest", () => {
    const plan = planDispatch(
      roadmap,
      "roadmap.yaml",
      { labels: LABELS, issues },
      { itemId: "p1-garage-loop" }
    );
    expect(plan.skipped.map((s) => [s.task.id, s.issue])).toEqual([
      ["job-board", 40],
      ["build-step", 41],
    ]);
    expect(plan.create.map((c) => c.task.id)).toEqual(["payout"]);
    const payout = plan.create[0];
    expect(payout?.blockedBy).toEqual([41]);
    // #41 is open → payout must NOT be ready
    expect(payout?.ready).toBe(false);
    expect(payout?.labels).toContain("roadmap");
    expect(payout?.labels).toContain("phase-1");
    expect(payout?.labels).not.toContain("ready");
    expect(payout?.title).toBe("[p1-garage-loop] Payout and reputation delta");
    expect(plan.needsLabel).toBe(false);
  });

  it("marks frontier tasks ready and chains blocked-by within one run", () => {
    // Nothing dispatched yet: remove the marker issues.
    const fresh = issues.filter((i) => i.number < 40);
    const plan = planDispatch(
      roadmap,
      "roadmap.yaml",
      { labels: LABELS, issues: fresh },
      { itemId: "p1-garage-loop", fleetEnv: "local" }
    );
    expect(plan.create.map((c) => c.task.id)).toEqual(["job-board", "build-step", "payout"]);
    expect(plan.create[0]?.ready).toBe(true);
    expect(plan.create[0]?.labels).toContain("ready");
    expect(plan.create[0]?.labels).toContain("fleet-local");
    expect(plan.create[1]?.ready).toBe(false);
    expect(plan.create[1]?.blockedByPending).toEqual(["p1-garage-loop/job-board"]);
  });

  it("refuses when depends_on is not done, unless forced", () => {
    // p2-second-vertical depends on p1-garage-loop, which is in progress. Give it a task first.
    const withTask = structuredClone(roadmap);
    const item = withTask.items.find((i) => i.id === "p2-second-vertical");
    item?.tasks.push({
      id: "t",
      title: "T",
      acceptance: ["a"],
      verify: ["v"],
      blocked_by: [],
      labels: [],
      fleet_env: null,
      interactive: false,
    });
    expect(() =>
      planDispatch(
        withTask,
        "roadmap.yaml",
        { labels: LABELS, issues },
        { itemId: "p2-second-vertical" }
      )
    ).toThrow(DispatchRefused);
    const forced = planDispatch(
      withTask,
      "roadmap.yaml",
      { labels: LABELS, issues },
      { itemId: "p2-second-vertical", forceFrontier: true }
    );
    expect(forced.create.length).toBe(1);
  });

  it("refuses items without tasks, dropped items, unknown items, missing ready label", () => {
    expect(() =>
      planDispatch(roadmap, "roadmap.yaml", { labels: LABELS, issues }, { itemId: "p1-art-drop" })
    ).toThrow(/no tasks/);
    expect(() =>
      planDispatch(
        roadmap,
        "roadmap.yaml",
        { labels: LABELS, issues },
        { itemId: "p0-dropped-idea" }
      )
    ).toThrow(/dropped/);
    expect(() =>
      planDispatch(roadmap, "roadmap.yaml", { labels: LABELS, issues }, { itemId: "nope" })
    ).toThrow(/no item/);
    expect(() =>
      planDispatch(
        roadmap,
        "roadmap.yaml",
        { labels: ["roadmap"], issues },
        { itemId: "p1-garage-loop" }
      )
    ).toThrow(/ready/);
  });

  it("refuses when a task label does not exist in the repo", () => {
    expect(() =>
      planDispatch(
        roadmap,
        "roadmap.yaml",
        { labels: ["ready", "roadmap"], issues },
        { itemId: "p1-garage-loop" }
      )
    ).toThrow(/labels missing/);
  });

  it("never adds auto-merge-ok unless asked", () => {
    const plan = planDispatch(
      roadmap,
      "roadmap.yaml",
      { labels: LABELS, issues },
      { itemId: "p1-garage-loop" }
    );
    expect(plan.create[0]?.labels).not.toContain("auto-merge-ok");
    const granted = planDispatch(
      roadmap,
      "roadmap.yaml",
      { labels: LABELS, issues },
      { itemId: "p1-garage-loop", autoMerge: true }
    );
    expect(granted.create[0]?.labels).toContain("auto-merge-ok");
  });

  it("warns when the repo is not in the fleetd allowlist", () => {
    const plan = planDispatch(
      roadmap,
      "roadmap.yaml",
      { labels: LABELS, issues },
      { itemId: "p1-garage-loop", fleetAllowlist: ["mechanics"] }
    );
    expect(plan.warnings.some((w) => w.includes("allowlist"))).toBe(true);
    expect(renderPlan(plan, roadmap)).toMatch(/allowlist/);
  });
});

describe("applyDispatch", () => {
  it("creates in topological order, resolves pending blockers to numbers, writes markers, is idempotent", async () => {
    const fresh = issues.filter((i) => i.number < 40);
    const client = fakeClient();
    const plan = planDispatch(
      roadmap,
      "roadmap.yaml",
      { labels: LABELS.filter((l) => l !== "roadmap"), issues: fresh },
      { itemId: "p1-garage-loop" }
    );
    expect(plan.needsLabel).toBe(true);
    const result = await applyDispatch(plan, roadmap, client);
    expect(result.labelCreated).toBe(true);
    expect(client.labelsCreated).toEqual(["roadmap"]);
    expect(result.created.map((c) => [c.task, c.number, c.ready])).toEqual([
      ["job-board", 100, true],
      ["build-step", 101, false],
      ["payout", 102, false],
    ]);
    const build = client.created[1];
    expect(build && parseBlockedBy(build.body)).toEqual([100]);
    const payout = client.created[2];
    expect(payout && parseBlockedBy(payout.body)).toEqual([101]);
    const markers = payout ? parseMarkers(payout.body) : [];
    expect(markers).toEqual([
      { kind: "item", file: "roadmap.yaml", itemId: "p1-garage-loop", taskId: null },
      { kind: "task", file: "roadmap.yaml", itemId: "p1-garage-loop", taskId: "payout" },
    ]);
    expect(payout?.body).toMatch(/## Acceptance Criteria\n\n- \[ \] Completing a job pays out/);
    expect(payout?.body).toMatch(/## Verification commands/);
    // non-public roadmap → no public link line
    expect(payout?.body).not.toMatch(/^Roadmap: http/m);

    // Re-run against the issues we just created: nothing left to create.
    const after: IssueSnapshot[] = [
      ...fresh,
      ...client.created.map((c) => ({
        number: c.number,
        title: c.title,
        state: "open" as const,
        labels: c.labels,
        body: c.body,
        url: "u",
      })),
    ];
    const again = planDispatch(
      roadmap,
      "roadmap.yaml",
      { labels: LABELS, issues: after },
      { itemId: "p1-garage-loop" }
    );
    expect(again.create).toEqual([]);
    expect(again.skipped.length).toBe(3);
  });
});
