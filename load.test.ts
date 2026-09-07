import path from "node:path";
import { describe, expect, it } from "vitest";
import { topoSort } from "./graph";
import { expandGlobs, loadAll, locate, parseConfig, parseEstate } from "./load";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MONO = path.join(HERE, "examples", "monorepo");

describe("locate", () => {
  it("finds a single roadmap.yaml from a nested cwd", async () => {
    const located = await locate(path.join(HERE, "examples", "minimal"));
    expect(located?.via).toBe("roadmap");
    expect(located?.files).toEqual(["roadmap.yaml"]);
  });
  it("prefers nextup.config.yaml and expands its globs in order", async () => {
    const located = await locate(path.join(MONO, "apps", "alpha"));
    expect(located?.via).toBe("config");
    expect(located?.root).toBe(MONO);
    expect(located?.files).toEqual([
      "roadmap.yaml",
      "apps/alpha/roadmap.yaml",
      "apps/beta/roadmap.yaml",
    ]);
  });
  it("returns null when nothing is found", async () => {
    expect(await locate("/")).toBeNull();
  });
  it("loads every file and reports none failed", async () => {
    const located = await locate(MONO);
    if (!located) throw new Error("locate");
    const all = await loadAll(located);
    expect(all.failed).toEqual([]);
    expect(all.loaded.map((l) => l.roadmap.meta.project)).toEqual(["platform", "alpha", "beta"]);
  });
});

describe("expandGlobs", () => {
  it("matches one segment per *", async () => {
    expect(await expandGlobs(MONO, ["apps/*/roadmap.yaml"])).toEqual([
      "apps/alpha/roadmap.yaml",
      "apps/beta/roadmap.yaml",
    ]);
    expect(await expandGlobs(MONO, ["apps/al*/roadmap.yaml"])).toEqual(["apps/alpha/roadmap.yaml"]);
    expect(await expandGlobs(MONO, ["nothing/*/roadmap.yaml", "roadmap.yaml"])).toEqual([
      "roadmap.yaml",
    ]);
  });
});

describe("config parsing", () => {
  it("parses nextup.config.yaml and estate.yaml", () => {
    expect(parseConfig("roadmaps: [roadmap.yaml]").ok).toBe(true);
    expect(parseConfig("roadmaps: []").ok).toBe(false);
    const estate = parseEstate(
      "repos:\n  - repo: o/r\n  - repo: o/s\n    files: [a/roadmap.yaml]\n"
    );
    expect(estate.ok).toBe(true);
    if (estate.ok) expect(estate.value.repos[0]?.files).toEqual(["roadmap.yaml"]);
  });
});

describe("topoSort", () => {
  it("orders dependencies first and keeps file order among peers", () => {
    const edges: Record<string, string[]> = { a: ["c"], b: [], c: [], d: ["a", "b"] };
    expect(topoSort(["a", "b", "c", "d"], (id) => edges[id] ?? [])).toEqual({
      order: ["b", "c", "a", "d"],
      cycle: [],
    });
  });
  it("reports cycles", () => {
    const edges: Record<string, string[]> = { a: ["b"], b: ["a"], c: [] };
    const r = topoSort(["a", "b", "c"], (id) => edges[id] ?? []);
    expect(r.order).toEqual(["c"]);
    expect(r.cycle.sort()).toEqual(["a", "b"]);
  });
});
