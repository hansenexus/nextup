import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRoadmap } from "./load";
import { validateRoadmap } from "./validate";

const HERE = path.dirname(new URL(import.meta.url).pathname);

function* roadmapFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* roadmapFiles(p);
    else if (name === "roadmap.yaml") yield p;
  }
}

describe("examples", () => {
  const files = [...roadmapFiles(path.join(HERE, "examples"))];
  it("has examples", () => expect(files.length).toBeGreaterThanOrEqual(5));
  for (const file of files) {
    it(`${path.relative(HERE, file)} parses and validates without errors`, async () => {
      const parsed = parseRoadmap(readFileSync(file, "utf8"));
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
      if (!parsed.ok) return;
      const r = await validateRoadmap(parsed.value, {
        today: "2099-01-01",
        root: path.dirname(file),
      });
      expect(r.errors).toEqual([]);
    });
  }
});

describe("template", () => {
  it("the init template is valid once its placeholders are filled", async () => {
    const text = readFileSync(path.join(HERE, "template", "roadmap.yaml"), "utf8")
      .replaceAll("__PROJECT__", "demo")
      .replaceAll("__REPO__", "o/demo")
      .replaceAll("__TODAY__", "2026-09-01")
      .replaceAll("__FIRST_PHASE_LOWER__", "p0")
      .replaceAll("__FIRST_PHASE__", "P0")
      .replace("__PHASES__", "  - id: P0\n    title: Start");
    const parsed = parseRoadmap(text);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    const r = await validateRoadmap(parsed.value, { today: "2099-01-01" });
    expect(r.errors).toEqual([]);
  });
});
