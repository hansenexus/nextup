import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CLI = path.join(HERE, "cli.ts");
const tmp = mkdtempSync(path.join(os.tmpdir(), "nextup-cli-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function run(args: string[], cwd = HERE, env: NodeJS.ProcessEnv = {}) {
  const res = spawnSync("bun", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
    timeout: 60_000,
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

/** No token in env and a gh config dir with no hosts, so `gh auth token` fails too. */
const NO_GH = {
  GH_CONFIG_DIR: mkdtempSync(path.join(os.tmpdir(), "nextup-nogh-")),
  NEXTUP_NO_GH: "1",
  GH_TOKEN: "",
  GITHUB_TOKEN: "",
  NEXTUP_GITHUB_TOKEN: "",
};

describe("nextup cli", () => {
  it("--help exits 0", () => {
    const r = run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("commands");
  });
  it("unknown command exits 2", () => {
    expect(run(["frobnicate"]).code).toBe(2);
  });
  it("validate: examples pass (0), an invalid fixture fails (1), a missing file is usage (2)", () => {
    expect(run(["validate", "--file", "examples/dev-empire/roadmap.yaml"]).code).toBe(0);
    const bad = run(["validate", "--file", "fixtures/invalid/V4-cycle.yaml"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("V4");
    expect(run(["validate", "--file", "nope.yaml"]).code).toBe(2);
    expect(run(["validate"], path.join(HERE, "examples", "monorepo")).code).toBe(0);
  });
  it("status without a token exits 3, with --no-github prints a stale table", () => {
    const r = run(["status", "--file", "examples/dev-empire/roadmap.yaml"], HERE, NO_GH);
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/token/);
    const stale = run(["status", "--file", "examples/dev-empire/roadmap.yaml", "--no-github"]);
    expect(stale.code).toBe(0);
    expect(stale.out).toContain("STALE");
    expect(stale.out).toContain("p1-garage-loop");
  });
  it("build --audience public refuses a non-public roadmap with 4", () => {
    const r = run([
      "build",
      "--file",
      "examples/dev-empire/roadmap.yaml",
      "--no-github",
      "--out",
      path.join(tmp, "de"),
    ]);
    expect(r.code).toBe(4);
    expect(r.out).toContain("meta.public is false");
  });
  it("build writes public JSON for a public roadmap and internal JSON elsewhere", () => {
    const out = path.join(tmp, "min");
    const r = run([
      "build",
      "--file",
      "examples/minimal/roadmap.yaml",
      "--no-github",
      "--out",
      out,
    ]);
    expect(r.code).toBe(0);
    const json = JSON.parse(readFileSync(path.join(out, "roadmap.public.json"), "utf8"));
    expect(json.project).toBe("minimal");
    expect(json.stale).toBe(true);
    const internal = run([
      "build",
      "--audience",
      "internal",
      "--file",
      "examples/dev-empire/roadmap.yaml",
      "--no-github",
      "--out",
      path.join(tmp, "int"),
    ]);
    expect(internal.code).toBe(0);
    expect(
      run([
        "build",
        "--audience",
        "internal",
        "--file",
        "examples/dev-empire/roadmap.yaml",
        "--no-github",
        "--out",
        path.join(tmp, "public"),
      ]).code
    ).toBe(4);
  });
  it("dispatch without a token exits 3; with an unknown item it is usage", () => {
    expect(
      run(["dispatch", "p1-garage-loop", "--file", "examples/dev-empire/roadmap.yaml"], HERE, NO_GH)
        .code
    ).toBe(3);
    expect(run(["dispatch"], HERE).code).toBe(2);
  });
  it("init scaffolds a file that validates, and refuses to overwrite", () => {
    const dir = path.join(tmp, "init");
    mkdirSync(dir, { recursive: true });
    const r = run(["init", "--project", "demo", "--repo", "o/demo", "--phases", "P0,P1"], dir);
    expect(r.code).toBe(0);
    expect(readFileSync(path.join(dir, "roadmap.yaml"), "utf8")).toContain("project: demo");
    expect(run(["validate"], dir).code).toBe(0);
    expect(run(["init"], dir).code).toBe(4);
    expect(
      run(["init", "--force", "--pages", "--project", "demo", "--repo", "o/demo"], dir).code
    ).toBe(0);
    expect(readFileSync(path.join(dir, ".github", "workflows", "roadmap.yml"), "utf8")).toContain(
      "--audience public"
    );
  });
});
