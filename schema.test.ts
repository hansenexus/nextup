import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRoadmap } from "./load";
import { roadmapJsonSchema, roadmapSchema } from "./schema";

const base = {
  schema: 1,
  meta: {
    project: "x",
    repo: "o/r",
    title: "X",
    version: 1,
    updated: "2026-09-01",
    current_phase: "P0",
  },
  phases: [{ id: "P0", title: "Start" }],
};

describe("roadmapSchema", () => {
  it("applies defaults: labels, locales, visibility, public=false", () => {
    const r = roadmapSchema.parse({ ...base, items: [{ id: "a", title: "A", phase: "P0" }] });
    expect(r.meta.locales).toEqual(["en"]);
    expect(r.meta.public).toBe(false);
    expect(r.meta.labels.in_progress).toContain("status:in-progress");
    expect(r.meta.labels.in_progress).toContain("status/in-progress");
    expect(r.items[0]?.visibility).toBe("internal");
    expect(r.items[0]?.kind).toBe("epic");
    expect(r.phases[0]?.visibility).toBe("public");
    expect(r.milestones).toEqual([]);
  });

  it("rejects unknown keys (strict)", () => {
    const res = roadmapSchema.safeParse({ ...base, meta: { ...base.meta, bogus: 1 } });
    expect(res.success).toBe(false);
  });

  it("refuses a day-date as a phase target", () => {
    const res = roadmapSchema.safeParse({
      ...base,
      phases: [{ id: "P0", title: "S", target: "2026-12-24" }],
    });
    expect(res.success).toBe(false);
  });

  it("accepts quarter and half targets", () => {
    for (const target of ["2026", "2026-Q4", "2027-H1"]) {
      expect(
        roadmapSchema.safeParse({ ...base, phases: [{ id: "P0", title: "S", target }] }).success
      ).toBe(true);
    }
  });

  it("accepts localized strings and plain strings", () => {
    const r = roadmapSchema.parse({ ...base, meta: { ...base.meta, title: { en: "X", de: "Y" } } });
    expect(r.meta.title).toEqual({ en: "X", de: "Y" });
  });

  it("only allows manual statuses a human may write", () => {
    const ok = roadmapSchema.safeParse({
      ...base,
      items: [{ id: "a", title: "A", phase: "P0", status: "planned", since: "2026-09-01" }],
    });
    expect(ok.success).toBe(true);
    const bad = roadmapSchema.safeParse({
      ...base,
      items: [{ id: "a", title: "A", phase: "P0", status: "in-progress" }],
    });
    expect(bad.success).toBe(false);
    const shipped = roadmapSchema.safeParse({
      ...base,
      items: [{ id: "a", title: "A", phase: "P0", status: "done", since: "2026-08-12" }],
    });
    expect(shipped.success).toBe(true);
  });

  it("requires acceptance and verify on tasks", () => {
    const bad = roadmapSchema.safeParse({
      ...base,
      items: [
        {
          id: "a",
          title: "A",
          phase: "P0",
          tasks: [{ id: "t", title: "T", acceptance: [], verify: ["x"] }],
        },
      ],
    });
    expect(bad.success).toBe(false);
  });
});

describe("schema/roadmap.schema.json", () => {
  it("matches the generated JSON schema (run `bun run schema:gen` when this fails)", () => {
    const committed = JSON.parse(
      readFileSync(new URL("./schema/roadmap.schema.json", import.meta.url), "utf8")
    );
    expect(committed).toEqual(roadmapJsonSchema());
  });

  it("describes what a human writes: items and milestones are optional", () => {
    const s = roadmapJsonSchema() as { required: string[] };
    expect(s.required).toEqual(["schema", "meta", "phases"]);
  });
});

describe("parseRoadmap", () => {
  it("returns findings for bad yaml", () => {
    const r = parseRoadmap("schema: [1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.rule).toBe("V1");
  });
  it("returns findings with paths for shape errors", () => {
    const r = parseRoadmap("schema: 1\nmeta: {}\nphases: []\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path.startsWith("meta"))).toBe(true);
  });
});
