import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFleetState } from "./fleet-state";
import { parseRoadmap } from "./load";
import { summarizeWaveText } from "./mechanics-waves";
import { toInternal, toPublic } from "./project";
import { renderRoadmapHTML } from "./render-html";
import { rollup } from "./rollup";
import type { IssueSnapshot } from "./types";
import { buildViewModel } from "./view-model";

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
  lanes: [{ issue: 41, runtime: "local", phase: "working" }],
  now: new Date("2026-09-07T12:00:00Z"),
});

describe("buildViewModel", () => {
  it("renders the version line and resolves locales with fallback", () => {
    const en = buildViewModel(toPublic(roadmap, roll), "en");
    expect(en.versionLine).toBe("v3 · as of 2026-09-07");
    const de = buildViewModel(toPublic(roadmap, roll), "de");
    expect(de.versionLine).toBe("v3 · Stand 2026-09-07");
    expect(de.phases[0]?.title).toBe("Grundgerüst");
    // "CI fast lane" has no German → falls back to English
    expect(de.phases[0]?.items.find((i) => i.id === "p0-ci")?.title).toBe("CI fast lane");
    expect(de.phases[1]?.items[0]?.statusLabel).toBe("in Arbeit");
  });
  it("marks the current phase and derives progress", () => {
    const vm = buildViewModel(toPublic(roadmap, roll), "en");
    expect(vm.phases.find((p) => p.isCurrent)?.id).toBe("P1");
    expect(vm.phases[0]?.progress).toEqual({ done: 2, total: 2, label: "2 of 2 done" });
  });
  it("draft milestones are undated, planned ones show the date", () => {
    const vm = buildViewModel(toPublic(roadmap, roll), "de");
    const p1 = vm.phases.find((p) => p.id === "P1");
    expect(p1?.milestones.find((m) => m.id === "p1-exit")?.dateLabel).toBe("ohne Termin");
    expect(p1?.milestones.find((m) => m.id === "p1-playtest")?.dateLabel).toBe("2026-12-15");
  });
  it("internal view carries issues and lanes; public view has no internal block", () => {
    const internal = buildViewModel(toInternal(roadmap, roll, "roadmap.yaml"), "en");
    const garage = internal.phases
      .find((p) => p.id === "P1")
      ?.items.find((i) => i.id === "p1-garage-loop");
    expect(garage?.internal?.issues.find((i) => i.number === 41)?.lane).toBe("local/working");
    const pub = buildViewModel(toPublic(roadmap, roll), "en");
    expect(pub.phases.flatMap((p) => p.items).every((i) => i.internal === null)).toBe(true);
  });
});

describe("renderRoadmapHTML", () => {
  it("escapes, marks phases and statuses, and includes the stale badge when stale", () => {
    const stale = rollup({
      roadmap,
      file: "roadmap.yaml",
      issues: [],
      stale: { reason: "no-github-token" },
    });
    const html = renderRoadmapHTML(buildViewModel(toPublic(roadmap, stale), "en"));
    expect(html).toContain('class="nextup-stale"');
    expect(html).toContain('data-phase="P1"');
    expect(html).toContain("is-current");
    expect(html).toContain("v3 · as of 2026-09-07");
    const evil = structuredClone(roadmap);
    if (evil.items[0]) evil.items[0].title = "<script>alert(1)</script>";
    const html2 = renderRoadmapHTML(buildViewModel(toInternal(evil, roll, "roadmap.yaml"), "en"));
    expect(html2).not.toContain("<script>alert");
    expect(html2).toContain("&lt;script&gt;");
  });
  it("compact mode is a class, not a different tree", () => {
    const html = renderRoadmapHTML(buildViewModel(toPublic(roadmap, roll), "en"), "compact");
    expect(html).toContain("is-view-compact");
  });
});

describe("readers", () => {
  it("summarizes a mechanics wave file", () => {
    const s = summarizeWaveText(
      "wave: w1\nstatus: open\nverifications:\n  - { mechanic: a, status: pass }\n  - { mechanic: b, status: n-a }\n  - { mechanic: c, status: fail }\n",
      "w1"
    );
    expect(s).toEqual({ wave: "w1", status: "open", total: 3, passing: 1, settled: 2 });
    expect(summarizeWaveText("not: [valid", "x")).toBeNull();
  });
  it("reads fleetd lanes for one repo and ignores foreign schemas", () => {
    const state = JSON.stringify({
      schema: 1,
      updated_at: "t",
      lanes: [
        { repo: "o/r", issue: 5, runtime: "hn-agent", phase: "working" },
        { repo: "o/other", issue: 6 },
      ],
    });
    expect(parseFleetState(state, "o/r")).toEqual([
      { issue: 5, repo: "o/r", runtime: "hn-agent", phase: "working", updatedAt: "t" },
    ]);
    expect(parseFleetState(state).length).toBe(2);
    expect(parseFleetState(JSON.stringify({ schema: 2, lanes: [] }))).toEqual([]);
    expect(parseFleetState("garbage")).toEqual([]);
  });
});
