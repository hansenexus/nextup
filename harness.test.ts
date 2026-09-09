import { describe, expect, it } from "vitest";
import {
  DEVICES,
  type HarnessState,
  harnessFrameQuery,
  type LoadedSkin,
  NO_SKIN,
  parseHarnessState,
  renderHarnessFrame,
  renderHarnessPage,
  VIEW_MODES,
} from "./harness";

const solo = { id: "lexilink", title: "lexilink", locales: ["de", "en"] };
const projects = [solo, { id: "other", title: "Other", locales: ["en"] }];
const skins = [{ id: "lexilink", label: "lexilink" }];
const parse = (q: string) => parseHarnessState(new URLSearchParams(q), { projects, skins });
const page = (state: HarnessState) => renderHarnessPage({ projects, skins, state });

describe("parseHarnessState", () => {
  it("defaults to the first project, the ledger view and its first locale", () => {
    const s = parse("");
    expect(s.project).toBe("lexilink");
    expect(s.view).toBe("ledger");
    expect(s.locale).toBe("de");
    expect(s.audience).toBe("internal");
    expect(s.theme).toBe("light");
    expect(s.skin).toBe(NO_SKIN);
  });
  it("falls back rather than trusting the query string", () => {
    // An unknown mode must not reach renderRoadmapHTML as a class name.
    expect(parse("view=../../etc/passwd").view).toBe("ledger");
    expect(parse("device=nonsense").device).toBe("laptop");
    expect(parse("theme=neon").theme).toBe("light");
    // An undeclared skin must not reach the file reader.
    expect(parse("skin=../../etc/passwd").skin).toBe(NO_SKIN);
    expect(parse("skin=lexilink").skin).toBe("lexilink");
    // A locale the project does not declare falls back to its first.
    expect(parse("project=other&locale=de").locale).toBe("en");
    expect(parse("project=ghost").project).toBe("lexilink");
  });
  it("round-trips every axis it accepts", () => {
    const s = parse(
      "project=other&view=bands&locale=en&audience=public&device=phone&theme=dark&landscape=1&skin=lexilink"
    );
    expect(s).toEqual({
      project: "other",
      skin: "lexilink",
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
    const html = page(parse("view=bands&device=phone"));
    for (const m of VIEW_MODES) expect(html).toContain(`value="${m}"`);
    for (const d of DEVICES) expect(html).toContain(`value="${d.id}"`);
    expect(html).toContain('<option value="bands" selected>');
    expect(html).toContain("/harness/frame?");
    // The project picker is hidden when there is nothing to pick.
    expect(renderHarnessPage({ projects: [solo], skins, state: parse("") })).not.toContain(
      'name="project"'
    );
    // No skins declared, no skin picker.
    expect(renderHarnessPage({ projects, skins: [], state: parse("") })).not.toContain(
      'name="skin"'
    );
    expect(html).toContain('name="skin"');
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

describe("renderHarnessFrame with a skin", () => {
  const skin: LoadedSkin = {
    id: "lexilink",
    label: "lexilink",
    css: ".roadmap-ledger .nextup-roadmap { --nextup-accent: #f3821d; }",
    wrapper: "roadmap-ledger",
    dark: "dark",
    links: ["https://fonts.googleapis.com/css2?family=Geist"],
  };

  it("wraps the roadmap, loads the host fonts, and puts the skin last", () => {
    const html = renderHarnessFrame("<p>x</p>", "light", "de", skin);
    expect(html).toContain('<div class="roadmap-ledger"><p>x</p></div>');
    expect(html).toContain(
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist">'
    );
    // Last wins: the skin's mapping must override the package defaults.
    expect(html.indexOf("--nextup-accent: #f3821d")).toBeGreaterThan(
      html.indexOf(".nextup-roadmap {")
    );
  });

  it("sets the host's dark class only on the dark ground", () => {
    expect(renderHarnessFrame("<p>x</p>", "dark", "de", skin)).toContain('class="dark"');
    expect(renderHarnessFrame("<p>x</p>", "light", "de", skin)).not.toContain('class="dark"');
  });

  it("renders unwrapped and unskinned when no skin is chosen", () => {
    const html = renderHarnessFrame("<p>x</p>", "light", "de", null);
    expect(html).toContain("<body><p>x</p></body>");
    expect(html).not.toContain("roadmap-ledger");
  });
});
