import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRoadmap } from "./load";
import type { Roadmap } from "./types";
import { validateRoadmap } from "./validate";

const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "invalid");
const TODAY = "2026-09-07";

function load(file: string): Roadmap | { rule: string } {
  const parsed = parseRoadmap(readFileSync(file, "utf8"));
  if (!parsed.ok) return { rule: parsed.errors[0]?.rule ?? "?" };
  return parsed.value;
}

describe("fixtures/invalid — each file fails exactly the rule in its name", () => {
  for (const name of readdirSync(FIXTURES).sort()) {
    const expected = name.split("-")[0] ?? "";
    it(`${name} → ${expected}`, async () => {
      const loaded = load(path.join(FIXTURES, name));
      if ("rule" in loaded) {
        expect(loaded.rule).toBe(expected);
        return;
      }
      const result = await validateRoadmap(loaded, { today: TODAY });
      expect(result.errors.map((e) => e.rule)).toContain(expected);
    });
  }
});

describe("validateRoadmap", () => {
  const good = readFileSync(
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "examples",
      "dev-empire",
      "roadmap.yaml"
    ),
    "utf8"
  );

  it("passes the dev-empire example with no errors", async () => {
    const parsed = parseRoadmap(good);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = await validateRoadmap(parsed.value, { today: TODAY });
    expect(r.errors).toEqual([]);
  });

  it("warns (V5) when an item depends on something scheduled later", async () => {
    const parsed = parseRoadmap(`schema: 1
meta: { project: x, repo: o/r, title: X, version: 1, updated: 2026-09-01, current_phase: P0 }
phases: [{ id: P0, title: A }, { id: P1, title: B }]
items:
  - { id: early, title: E, phase: P0, depends_on: [late] }
  - { id: late, title: L, phase: P1 }
`);
    if (!parsed.ok) throw new Error("parse");
    const r = await validateRoadmap(parsed.value, { today: TODAY });
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.rule)).toContain("V5");
  });

  it("warns (V7) when public text looks like it leaks internals", async () => {
    const parsed = parseRoadmap(`schema: 1
meta: { project: x, repo: o/r, title: X, version: 1, updated: 2026-09-01, current_phase: P0 }
phases: [{ id: P0, title: A }]
items:
  - { id: a, title: "Fix #123 for @lennard", summary: "status:blocked lane", phase: P0, visibility: public }
`);
    if (!parsed.ok) throw new Error("parse");
    const r = await validateRoadmap(parsed.value, { today: TODAY });
    expect(r.warnings.filter((w) => w.rule === "V7").length).toBeGreaterThanOrEqual(2);
  });

  it("warns (V8) when a declared locale has no text on a public item", async () => {
    const parsed = parseRoadmap(`schema: 1
meta: { project: x, repo: o/r, title: X, locales: [en, de], version: 1, updated: 2026-09-01, current_phase: P0 }
phases: [{ id: P0, title: A }]
items:
  - { id: a, title: { en: Only English }, summary: { en: S }, phase: P0, visibility: public }
`);
    if (!parsed.ok) throw new Error("parse");
    const r = await validateRoadmap(parsed.value, { today: TODAY });
    expect(r.warnings.map((w) => w.rule)).toContain("V8");
  });

  it("errors (V6) on a draft milestone carrying a date and on reached without reached_at", async () => {
    const parsed = parseRoadmap(`schema: 1
meta: { project: x, repo: o/r, title: X, version: 1, updated: 2026-09-01, current_phase: P0 }
phases: [{ id: P0, title: A }]
items: [{ id: a, title: A, phase: P0 }]
milestones:
  - { id: m1, title: M, phase: P0, status: draft, date: 2026-12-01, source: { kind: user, by: me, at: 2026-09-01 } }
  - { id: m2, title: N, phase: P0, status: reached, date: 2026-08-01, source: { kind: user, by: me, at: 2026-09-01 } }
`);
    if (!parsed.ok) throw new Error("parse");
    const r = await validateRoadmap(parsed.value, { today: TODAY });
    const v6 = r.errors.filter((e) => e.rule === "V6");
    expect(v6.length).toBe(2);
  });

  it("errors (V14) when the wave file is missing under root", async () => {
    const parsed = parseRoadmap(`schema: 1
meta: { project: x, repo: o/r, title: X, version: 1, updated: 2026-09-01, current_phase: P0, mechanics_waves: waves }
phases: [{ id: P0, title: A }]
items: [{ id: a, title: A, phase: P0, mechanics_wave: w1 }]
`);
    if (!parsed.ok) throw new Error("parse");
    const r = await validateRoadmap(parsed.value, { today: TODAY, root: "/nonexistent" });
    expect(r.errors.map((e) => e.rule)).toContain("V14");
  });
});
