import { describe, expect, it } from "vitest";
import { GITHUB_LINK_REF, resolveLink, resolveLinks } from "./links";

const REPO = "hansenexus/new-campus";
const BASE = `https://github.com/${REPO}/blob/${GITHUB_LINK_REF}/`;

describe("resolveLink", () => {
  it("leaves absolute URLs untouched", () => {
    for (const url of [
      "https://example.com/x",
      "http://example.com/x?y=1#z",
      "HTTPS://EXAMPLE.COM",
      "//cdn.example.com/asset.png",
      "ftp://host/file",
    ])
      expect(resolveLink(url, REPO)).toBe(url);
  });
  it("leaves #fragment-only and mailto:/tel: links untouched", () => {
    expect(resolveLink("#section", REPO)).toBe("#section");
    expect(resolveLink("mailto:hello@example.com", REPO)).toBe("mailto:hello@example.com");
    expect(resolveLink("tel:+491234", REPO)).toBe("tel:+491234");
    // …even when no repo is known: nothing to resolve against is needed.
    expect(resolveLink("#section", null)).toBe("#section");
    expect(resolveLink("mailto:a@b", null)).toBe("mailto:a@b");
  });
  it("resolves a relative path against the repo at HEAD", () => {
    expect(resolveLink("docs/design/blueprint-module.md", REPO)).toBe(
      `${BASE}docs/design/blueprint-module.md`
    );
    expect(GITHUB_LINK_REF).toBe("HEAD");
  });
  it("keeps the fragment and query of a relative path", () => {
    expect(resolveLink("docs/PLAN.md#phasing", REPO)).toBe(`${BASE}docs/PLAN.md#phasing`);
    expect(resolveLink("docs/PLAN.md?plain=1#phasing", REPO)).toBe(
      `${BASE}docs/PLAN.md?plain=1#phasing`
    );
  });
  it("normalizes ./, /, // and a trailing slash to a repo-root path", () => {
    expect(resolveLink("./docs/x.md", REPO)).toBe(`${BASE}docs/x.md`);
    expect(resolveLink("/docs/x.md", REPO)).toBe(`${BASE}docs/x.md`);
    expect(resolveLink("docs//x.md", REPO)).toBe(`${BASE}docs/x.md`);
    expect(resolveLink("docs/a/../x.md", REPO)).toBe(`${BASE}docs/x.md`);
    expect(resolveLink("docs/", REPO)).toBe(`${BASE}docs`);
  });
  it("drops what it cannot resolve: no repo, a path above the root, query-only, empty", () => {
    expect(resolveLink("docs/x.md", null)).toBeNull();
    expect(resolveLink("../other-repo/x.md", REPO)).toBeNull();
    expect(resolveLink("docs/../../x.md", REPO)).toBeNull();
    expect(resolveLink("?tab=readme", REPO)).toBeNull();
    expect(resolveLink(".", REPO)).toBeNull();
    expect(resolveLink("", REPO)).toBeNull();
  });
});

describe("resolveLinks", () => {
  it("maps every link and drops the unresolvable ones, keeping order and titles", () => {
    const links = [
      { title: "site", url: "https://example.com" },
      { title: "escapes", url: "../x" },
      { title: "doc", url: "docs/x.md" },
    ];
    expect(resolveLinks(links, REPO)).toEqual([
      { title: "site", url: "https://example.com" },
      { title: "doc", url: `${BASE}docs/x.md` },
    ]);
    expect(resolveLinks(links, null)).toEqual([{ title: "site", url: "https://example.com" }]);
    expect(resolveLinks([], REPO)).toEqual([]);
  });
});
