import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { guardInternalOut, LoadError, loadStatus, packageAsset, writeBuild } from "./build";
import { findForbiddenKeys } from "./project";
import { publicRoadmapSchema } from "./schema";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const tmp = mkdtempSync(path.join(os.tmpdir(), "nextup-build-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("loadStatus (offline)", () => {
  it("loads the located roadmap and marks it stale without GitHub", async () => {
    const statuses = await loadStatus({
      cwd: path.join(HERE, "examples", "minimal"),
      noGithub: true,
      today: "2026-09-07",
    });
    expect(statuses.length).toBe(1);
    expect(statuses[0]?.rollup.stale).toBe(true);
    expect(statuses[0]?.rollup.staleReason).toMatch(/no-github/);
    expect(statuses[0]?.validation.errors).toEqual([]);
  });
  it("loads every roadmap of a monorepo config", async () => {
    const statuses = await loadStatus({
      cwd: path.join(HERE, "examples", "monorepo", "apps", "beta"),
      noGithub: true,
      today: "2026-09-07",
    });
    expect(statuses.map((s) => s.file)).toEqual([
      "roadmap.yaml",
      "apps/alpha/roadmap.yaml",
      "apps/beta/roadmap.yaml",
    ]);
  });
  it("throws a LoadError(2) when nothing is found and (1) on a broken file", async () => {
    await expect(loadStatus({ cwd: os.tmpdir(), noGithub: true })).rejects.toMatchObject({
      code: 2,
    });
    const broken = path.join(tmp, "broken.yaml");
    writeFileSync(broken, "schema: 1\nmeta: {}\n");
    await expect(
      loadStatus({ cwd: tmp, file: "broken.yaml", noGithub: true })
    ).rejects.toBeInstanceOf(LoadError);
  });
});

describe("writeBuild", () => {
  it("writes a public projection, an index and (with site) the page + bundle", async () => {
    const statuses = await loadStatus({
      cwd: path.join(HERE, "examples", "minimal"),
      noGithub: true,
      today: "2026-09-07",
    });
    const out = path.join(tmp, "public-out");
    const report = await writeBuild(statuses, { audience: "public", out, site: true });
    expect(report.refused).toEqual([]);
    expect(report.written.sort()).toEqual(
      [
        ".nojekyll",
        "index.html",
        "index.json",
        "nextup-roadmap.iife.js",
        "roadmap.public.json",
      ].sort()
    );
    const json = JSON.parse(readFileSync(path.join(out, "roadmap.public.json"), "utf8"));
    expect(publicRoadmapSchema.safeParse(json).success).toBe(true);
    expect(json.stale).toBe(true);
    expect(findForbiddenKeys(json)).toEqual([]);
    const html = readFileSync(path.join(out, "index.html"), "utf8");
    expect(html).toContain('data-audience="public"');
    expect(html).not.toContain("__AUDIENCE__");
    const index = JSON.parse(readFileSync(path.join(out, "index.json"), "utf8"));
    expect(index).toEqual([
      expect.objectContaining({
        project: "minimal",
        path: "roadmap.public.json",
        audience: "public",
      }),
    ]);
  });

  it("refuses the public audience for a non-public roadmap", async () => {
    const statuses = await loadStatus({
      cwd: path.join(HERE, "examples", "dev-empire"),
      noGithub: true,
      today: "2026-09-07",
    });
    const report = await writeBuild(statuses, {
      audience: "public",
      out: path.join(tmp, "refused"),
    });
    expect(report.refused).toEqual([{ project: "dev-empire", reason: "meta.public is false" }]);
    expect(report.written).toEqual(["index.json"]);
  });

  it("writes per-project directories for several roadmaps and skips non-public ones", async () => {
    const statuses = await loadStatus({
      cwd: path.join(HERE, "examples", "monorepo"),
      noGithub: true,
      today: "2026-09-07",
    });
    const out = path.join(tmp, "mono");
    const report = await writeBuild(statuses, { audience: "public", out });
    expect(report.refused.map((r) => r.project)).toEqual(["platform"]);
    expect(report.written.sort()).toEqual(
      ["alpha/roadmap.public.json", "beta/roadmap.public.json", "index.json"].sort()
    );
  });

  it("nests under <project>/ whenever a config lists the roadmaps, even a single one", async () => {
    // A consumer's URL must not move the day a second app adds a roadmap.
    const repo = path.join(tmp, "config-single");
    mkdirSync(repo, { recursive: true });
    writeFileSync(path.join(repo, "nextup.config.yaml"), "roadmaps: [roadmap.yaml]\n");
    writeFileSync(
      path.join(repo, "roadmap.yaml"),
      readFileSync(path.join(HERE, "examples", "minimal", "roadmap.yaml"), "utf8")
    );
    const statuses = await loadStatus({ cwd: repo, noGithub: true, today: "2026-09-07" });
    expect(statuses[0]?.source).toBe("config");
    const out = path.join(tmp, "config-single-out");
    const report = await writeBuild(statuses, { audience: "public", out });
    const project = statuses[0]?.roadmap.meta.project ?? "";
    expect(report.written.sort()).toEqual([`${project}/roadmap.public.json`, "index.json"].sort());
    const index = JSON.parse(readFileSync(path.join(out, "index.json"), "utf8"));
    expect(index[0]?.path).toBe(`${project}/roadmap.public.json`);
  });

  it("writes flat when the roadmap was found on its own (--file or nearest roadmap.yaml)", async () => {
    const statuses = await loadStatus({
      cwd: path.join(HERE, "examples", "minimal"),
      noGithub: true,
      today: "2026-09-07",
    });
    expect(statuses[0]?.source).toBe("file");
    const out = path.join(tmp, "flat-out");
    const report = await writeBuild(statuses, { audience: "public", out });
    expect(report.written.sort()).toEqual(["index.json", "roadmap.public.json"]);
  });

  it("internal audience refuses pages-like output directories", () => {
    expect(guardInternalOut(path.join(tmp, "dist", "public"))).toMatch(/public/);
    expect(guardInternalOut(path.join(tmp, "gh-pages"))).toMatch(/gh-pages/);
    expect(guardInternalOut(path.join(tmp, "internal-site"))).toBeNull();
  });

  it("internal audience includes issues and never lands in a public dir", async () => {
    const statuses = await loadStatus({
      cwd: path.join(HERE, "examples", "dev-empire"),
      noGithub: true,
      today: "2026-09-07",
    });
    const out = path.join(tmp, "internal-site");
    await writeBuild(statuses, { audience: "internal", out });
    const json = JSON.parse(readFileSync(path.join(out, "roadmap.internal.json"), "utf8"));
    expect(json.audience).toBe("internal");
    expect(json.items.find((i: { id: string }) => i.id === "p0-simcore").issues).toEqual([1, 2]);
    await expect(
      writeBuild(statuses, { audience: "internal", out: path.join(tmp, "public") })
    ).rejects.toMatchObject({ code: 4 });
  });

  it("--check reports drift after the yaml changes, ignoring generated_at", async () => {
    const dir = path.join(tmp, "check");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "roadmap.yaml");
    writeFileSync(
      file,
      readFileSync(path.join(HERE, "examples", "minimal", "roadmap.yaml"), "utf8"),
      { flag: "w" }
    );
    const first = await loadStatus({ cwd: dir, noGithub: true, today: "2026-09-07" });
    const out = path.join(dir, "out");
    await writeBuild(first, { audience: "public", out });
    const again = await loadStatus({
      cwd: dir,
      noGithub: true,
      today: "2026-09-07",
      now: new Date("2030-01-01"),
    });
    expect((await writeBuild(again, { audience: "public", out, check: true })).drift).toEqual([]);
    writeFileSync(file, readFileSync(file, "utf8").replace("version: 1", "version: 2"));
    const changed = await loadStatus({ cwd: dir, noGithub: true, today: "2026-09-07" });
    expect((await writeBuild(changed, { audience: "public", out, check: true })).drift).toContain(
      "roadmap.public.json"
    );
  });
});

describe("packageAsset", () => {
  it("resolves through a path that needs percent-decoding (bunx installs `nextup@^0.1`)", async () => {
    const root = path.join(tmp, "nextup@^0.1");
    mkdirSync(path.join(root, "dist"), { recursive: true });
    mkdirSync(path.join(root, "site-template"), { recursive: true });
    writeFileSync(path.join(root, "site-template", "index.html"), "<html></html>");
    const from = pathToFileURL(path.join(root, "dist", "cli.js")).href;
    expect(from).toContain("%5E");
    expect(await packageAsset("site-template/index.html", from)).toBe(
      path.join(root, "site-template", "index.html")
    );
  });
  it("returns null when the asset does not exist anywhere up the tree", async () => {
    const from = pathToFileURL(path.join(tmp, "nowhere", "dist", "cli.js")).href;
    expect(await packageAsset("site-template/index.html", from)).toBeNull();
  });
});
