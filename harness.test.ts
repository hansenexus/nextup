import { describe, expect, it } from "vitest";
import {
  DEVICES,
  type HarnessState,
  harnessFrameQuery,
  parseHarnessState,
  renderHarnessFrame,
  renderHarnessPage,
  VIEW_MODES,
} from "./harness";

const solo = { id: "lexilink", title: "lexilink", locales: ["de", "en"] };
const projects = [solo, { id: "other", title: "Other", locales: ["en"] }];
const parse = (q: string) => parseHarnessState(new URLSearchParams(q), { projects });

describe("parseHarnessState", () => {
  it("defaults to the first project, the ledger view and its first locale", () => {
    const s = parse("");
    expect(s.project).toBe("lexilink");
    expect(s.view).toBe("ledger");
    expect(s.locale).toBe("de");
    expect(s.audience).toBe("internal");
    expect(s.theme).toBe("light");
  });
  it("falls back rather than trusting the query string", () => {
    // An unknown mode must not reach renderRoadmapHTML as a class name.
    expect(parse("view=../../etc/passwd").view).toBe("ledger");
    expect(parse("device=nonsense").device).toBe("laptop");
    expect(parse("theme=neon").theme).toBe("light");
    // A locale the project does not declare falls back to its first.
    expect(parse("project=other&locale=de").locale).toBe("en");
    expect(parse("project=ghost").project).toBe("lexilink");
  });
  it("round-trips every axis it accepts", () => {
    const s = parse(
      "project=other&view=bands&locale=en&audience=public&device=phone&theme=dark&landscape=1"
    );
    expect(s).toEqual({
      project: "other",
      view: "bands",
      locale: "en",
      audience: "public",
      device: "phone",
      theme: "dark",
      landscape: true,
    } satisfies HarnessState);
    expect(harnessFrameQuery(s)).toContain("view=bands");
    expect(harnessFrameQuery(s)).toContain("theme=dark");
  });
});

describe("renderHarnessPage", () => {
  it("offers every view mode and device, and marks the current state", () => {
    const html = renderHarnessPage({ projects, state: parse("view=bands&device=phone") });
    for (const m of VIEW_MODES) expect(html).toContain(`value="${m}"`);
    for (const d of DEVICES) expect(html).toContain(`value="${d.id}"`);
    expect(html).toContain('<option value="bands" selected>');
    expect(html).toContain("/harness/frame?");
    // The project picker is hidden when there is nothing to pick.
    expect(renderHarnessPage({ projects: [solo], state: parse("") })).not.toContain(
      'name="project"'
    );
  });
});

describe("renderHarnessFrame", () => {
  it("forces the ground with the attribute the stylesheet understands", () => {
    const dark = renderHarnessFrame("<p>x</p>", "dark", "de");
    expect(dark).toContain('data-nextup-theme="dark"');
    expect(dark).toContain('lang="de"');
    expect(dark).toContain("color-scheme: dark");
    expect(renderHarnessFrame("<p>x</p>", "light", "en")).toContain('data-nextup-theme="light"');
  });
});
