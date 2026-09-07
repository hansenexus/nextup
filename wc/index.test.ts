// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRoadmap } from "../load";
import { toPublic } from "../project";
import { rollup } from "../rollup";
import { defineNextupRoadmap, NextupRoadmapElement } from "./index";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const parsed = parseRoadmap(
  readFileSync(path.join(HERE, "..", "examples", "minimal", "roadmap.yaml"), "utf8")
);
if (!parsed.ok) throw new Error("fixture");
const data = toPublic(
  parsed.value,
  rollup({ roadmap: parsed.value, file: "roadmap.yaml", issues: [] })
);

describe("<nextup-roadmap>", () => {
  it("defines once and renders assigned data into its shadow root", () => {
    defineNextupRoadmap();
    defineNextupRoadmap();
    expect(customElements.get("nextup-roadmap")).toBe(NextupRoadmapElement);
    const el = document.createElement("nextup-roadmap") as NextupRoadmapElement;
    document.body.appendChild(el);
    el.setAttribute("lang", "de");
    el.data = data;
    const html = el.shadowRoot?.innerHTML ?? "";
    expect(html).toContain("<style>");
    expect(html).toContain("v1 · Stand 2026-09-01");
    expect(html).toContain('data-phase="P0"');
    el.setAttribute("view", "list");
    expect(el.shadowRoot?.innerHTML).toContain("is-view-list");
  });
  it("shows a placeholder before data arrives", () => {
    const el = document.createElement("nextup-roadmap") as NextupRoadmapElement;
    document.body.appendChild(el);
    expect(el.shadowRoot?.innerHTML).toContain("nextup-empty");
  });
});
