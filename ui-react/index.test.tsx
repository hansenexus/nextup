import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseRoadmap } from "../load";
import { toInternal, toPublic } from "../project";
import { rollup } from "../rollup";
import type { IssueSnapshot } from "../types";
import { Roadmap } from "./index";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const parsed = parseRoadmap(
  readFileSync(path.join(HERE, "..", "examples", "dev-empire", "roadmap.yaml"), "utf8")
);
if (!parsed.ok) throw new Error("fixture");
const roadmap = parsed.value;
const issues = JSON.parse(
  readFileSync(path.join(HERE, "..", "fixtures", "github", "dev-empire-issues.json"), "utf8")
) as IssueSnapshot[];
const roll = rollup({
  roadmap,
  file: "roadmap.yaml",
  issues,
  now: new Date("2026-09-07T12:00:00Z"),
});

describe("<Roadmap>", () => {
  it("renders as a server component (no hooks, no fetch)", () => {
    const html = renderToStaticMarkup(
      <Roadmap data={toPublic(roadmap, roll)} locale="de" view="compact" />
    );
    expect(html).toContain("v3 · Stand 2026-09-07");
    expect(html).toContain("is-view-compact");
    expect(html).toContain('data-phase="P1"');
    expect(html).toContain("Garagen-Schleife");
    expect(html).not.toContain("nextup-internal");
  });
  it("shows internal detail for internal data and a stale badge when stale", () => {
    const stale = rollup({ roadmap, file: "roadmap.yaml", issues: [], stale: { reason: "x" } });
    const html = renderToStaticMarkup(
      <Roadmap data={toInternal(roadmap, stale, "roadmap.yaml")} locale="en" />
    );
    expect(html).toContain("nextup-stale");
    expect(html).toContain("nextup-internal");
  });
  it("falls back to the roadmap's first locale", () => {
    const html = renderToStaticMarkup(<Roadmap data={toPublic(roadmap, roll)} />);
    expect(html).toContain('lang="en"');
  });
  it("names the phase progress bar and counts it in items, in the requested locale", () => {
    // P0 in dev-empire: 2 of 2 public items done.
    const en = renderToStaticMarkup(<Roadmap data={toPublic(roadmap, roll)} locale="en" />);
    expect(en).toContain(
      '<div class="nextup-progress" role="progressbar" aria-label="2 of 2 done" aria-valuemin="0" aria-valuemax="2" aria-valuenow="2">'
    );
    const de = renderToStaticMarkup(<Roadmap data={toPublic(roadmap, roll)} locale="de" />);
    expect(de).toContain('aria-label="2 von 2 erledigt" aria-valuemin="0" aria-valuemax="2"');
    // Never percent: a bar over 100 would read as "2 of 100".
    expect(en).not.toContain('aria-valuemax="100"');
  });
  it("emits item links already resolved against the repo", () => {
    const html = renderToStaticMarkup(<Roadmap data={toPublic(roadmap, roll)} locale="en" />);
    expect(html).toContain(
      'href="https://github.com/example/dev-empire/blob/HEAD/docs/PLAN.md#phasing"'
    );
    expect(html).not.toContain('href="docs/');
  });
});
