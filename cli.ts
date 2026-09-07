#!/usr/bin/env node
/**
 * nextup CLI.
 *
 *   nextup init      [--project s] [--repo owner/name] [--phases P0,P1,P2] [--pages] [--force]
 *   nextup validate  [--file f] [--live] [--json]
 *   nextup status    [--file f] [--json] [--orphans] [--fleet-state p] [--no-github]
 *   nextup next      [--file f] [--json] [--no-github]
 *   nextup dispatch  <item> [--task id]… [--env e] [--auto-merge] [--interactive]
 *                    [--force-frontier] [--apply] [--json]
 *   nextup build     [--audience public|internal] [--file f | --estate cfg] [--out dir]
 *                    [--site] [--check] [--fleet-state p] [--no-github]
 *   nextup serve     [--port 4177] [--static dir] [--fleet-state p]
 *   nextup mcp
 *
 * Exit codes: 0 ok · 1 validation/rollup error or drift · 2 usage / no file ·
 * 3 GitHub unavailable · 4 refused precondition.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LoadError, type LoadedStatus, loadStatus, packageAsset, writeBuild } from "./build";
import { applyDispatch, DispatchRefused, planDispatch, renderPlan } from "./dispatch";
import { frontier } from "./frontier";
import { createGitHubClient } from "./github";
import { parseEstate } from "./load";
import { serveMcp } from "./mcp";
import { toInternal } from "./project";
import { createServer, listen } from "./serve";
import { resolveToken } from "./token";
import type { Roadmap } from "./types";
import { formatFindings } from "./validate";

const EXIT = { ok: 0, error: 1, usage: 2, github: 3, refused: 4 } as const;

const HELP = `nextup — roadmaps as a committed roadmap.yaml

commands
  init       scaffold roadmap.yaml (+ --pages workflow)
  validate   check the file(s); --live also checks issue links on GitHub
  status     roll status up from GitHub issues (table; --json)
  next       what is dispatchable now
  dispatch   open issues for an item's tasks (dry run; --apply to create)
  build      write roadmap.public.json / roadmap.internal.json (+ --site)
  serve      loopback dev server for the internal view (--static <dir> to serve a build)
  mcp        read-only MCP server on stdio

flags
  --file f            one roadmap file (default: located from cwd, all of them)
  --no-github         do not contact GitHub; output is marked stale
  --fleet-state p     enrich with fleetd lanes (~/.claude/fleet/state.json)
  --json              machine output
  --audience a        public | internal (build)
  --out dir           output directory (build; default dist/roadmap)
  --site              also write index.html + the web component bundle (build)
  --check             exit 1 when existing output differs (build)
  --estate cfg        build every repo listed in an estate yaml via the GitHub API
  --apply             dispatch for real
  --env e             fleet-<e> label on dispatched issues
  --auto-merge        add auto-merge-ok (only when the user grants it)
  --force-frontier    dispatch even when depends_on is not done

exit codes: 0 ok · 1 error/drift · 2 usage · 3 github unavailable · 4 refused
`;

interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const [command = "", ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? "";
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) {
      flags.set(a.slice(2, eq), a.slice(eq + 1));
      continue;
    }
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--") && !BOOLEAN_FLAGS.has(key)) {
      // repeatable flags collect
      if (key === "task") {
        const prev = flags.get(key);
        flags.set(key, typeof prev === "string" ? `${prev},${next}` : next);
      } else flags.set(key, next);
      i++;
    } else flags.set(key, true);
  }
  return { command, positional, flags };
}

const BOOLEAN_FLAGS = new Set([
  "json",
  "live",
  "no-github",
  "no-cache",
  "site",
  "check",
  "apply",
  "auto-merge",
  "interactive",
  "force-frontier",
  "orphans",
  "pages",
  "force",
  "all",
  "help",
  "h",
]);

const str = (args: Args, key: string): string | undefined => {
  const v = args.flags.get(key);
  return typeof v === "string" ? v : undefined;
};
const bool = (args: Args, key: string): boolean => args.flags.has(key);

const COLOUR =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb" &&
  (process.env.FORCE_COLOR !== undefined || Boolean(process.stdout.isTTY));
const paint = (code: string) => (s: string) => (COLOUR && s ? `[${code}m${s}[0m` : s);
const bold = paint("1");
const dim = paint("2");
const red = paint("31");
const green = paint("32");
const yellow = paint("33");
const blue = paint("34");

function fail(code: number, message: string): never {
  console.error(red(message));
  process.exit(code);
}

function fleetStatePath(args: Args): string | null {
  const v = str(args, "fleet-state");
  if (!v) return null;
  return v.startsWith("~") ? path.join(os.homedir(), v.slice(1)) : v;
}

async function loadOrExit(
  args: Args,
  opts: { requireGithub?: boolean } = {}
): Promise<LoadedStatus[]> {
  const noGithub = bool(args, "no-github");
  const token = noGithub ? null : resolveToken();
  if (!noGithub && !token && opts.requireGithub) {
    fail(
      EXIT.github,
      "no GitHub token: set GH_TOKEN / GITHUB_TOKEN, log in with `gh auth login`, or pass --no-github"
    );
  }
  try {
    return await loadStatus({
      cwd: process.cwd(),
      file: str(args, "file"),
      fleetStatePath: fleetStatePath(args),
      noGithub,
      token,
    });
  } catch (e) {
    if (e instanceof LoadError) fail(e.code, e.message);
    throw e;
  }
}

function printValidation(statuses: LoadedStatus[]): boolean {
  let failed = false;
  for (const s of statuses) {
    const text = formatFindings(s.validation, s.file);
    if (text) console.log(text);
    if (s.validation.errors.length > 0) failed = true;
  }
  return failed;
}

// ---------------------------------------------------------------------------

async function cmdInit(args: Args): Promise<number> {
  const cwd = process.cwd();
  const target = path.join(cwd, "roadmap.yaml");
  const force = bool(args, "force");
  try {
    await fs.access(target);
    if (!force) fail(EXIT.refused, "roadmap.yaml exists — pass --force to overwrite");
  } catch {
    // absent, good
  }
  const project =
    str(args, "project") ??
    path
      .basename(cwd)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
  const repo = str(args, "repo") ?? (await guessRepo(cwd)) ?? `owner/${project}`;
  const phases = (str(args, "phases") ?? "P0,P1,P2")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const first = phases[0] ?? "P0";
  const templatePath = await packageAsset("template/roadmap.yaml");
  if (!templatePath) fail(EXIT.usage, "template/roadmap.yaml missing from package");
  const today = new Date().toISOString().slice(0, 10);
  const phaseBlock = phases
    .map(
      (p, i) =>
        `  - id: ${p}\n    title: ${p}\n    goal: ${i === 0 ? "The smallest thing that can be used." : "…"}`
    )
    .join("\n");
  const text = (await fs.readFile(templatePath, "utf8"))
    .replaceAll("__PROJECT__", project)
    .replaceAll("__REPO__", repo)
    .replaceAll("__TODAY__", today)
    .replaceAll("__FIRST_PHASE_LOWER__", first.toLowerCase())
    .replaceAll("__FIRST_PHASE__", first)
    .replace("__PHASES__", phaseBlock);
  await fs.writeFile(target, text);
  console.log(`${green("wrote")} roadmap.yaml (${project}, ${repo}, phases ${phases.join(" → ")})`);

  if (bool(args, "pages")) {
    const wfTemplate = await packageAsset("template/roadmap-pages.yml");
    if (!wfTemplate) fail(EXIT.usage, "template/roadmap-pages.yml missing from package");
    const wfDir = path.join(cwd, ".github", "workflows");
    await fs.mkdir(wfDir, { recursive: true });
    const branch = (await guessDefaultBranch(cwd)) ?? "main";
    const pkg = JSON.parse(
      (await fs
        .readFile((await packageAsset("package.json")) ?? "", "utf8")
        .catch(() => '{"version":"latest"}')) as string
    ) as { version?: string };
    const wf = (await fs.readFile(wfTemplate, "utf8"))
      .replaceAll("__DEFAULT_BRANCH__", branch)
      .replaceAll("__VERSION__", pkg.version ? `^${pkg.version}` : "latest");
    await fs.writeFile(path.join(wfDir, "roadmap.yml"), wf);
    console.log(
      `${green("wrote")} .github/workflows/roadmap.yml — enable Pages: gh api -X POST repos/${repo}/pages -f build_type=workflow`
    );
  }
  const gi = path.join(cwd, ".gitignore");
  try {
    const cur = await fs.readFile(gi, "utf8");
    const add = [".nextup/", "roadmap.internal.json"].filter((l) => !cur.split("\n").includes(l));
    if (add.length > 0) await fs.writeFile(gi, `${cur.replace(/\n?$/, "\n")}${add.join("\n")}\n`);
  } catch {
    // no .gitignore — leave it
  }
  console.log(dim("next: edit roadmap.yaml, then `nextup validate`"));
  return EXIT.ok;
}

async function guessRepo(cwd: string): Promise<string | null> {
  try {
    const cfg = await fs.readFile(path.join(cwd, ".git", "config"), "utf8");
    const m = cfg.match(/github\.com[:/]([^/\s]+\/[^/\s.]+)(?:\.git)?/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

async function guessDefaultBranch(cwd: string): Promise<string | null> {
  try {
    const head = await fs.readFile(
      path.join(cwd, ".git", "refs", "remotes", "origin", "HEAD"),
      "utf8"
    );
    return head.trim().split("/").pop() ?? null;
  } catch {
    try {
      const head = await fs.readFile(path.join(cwd, ".git", "HEAD"), "utf8");
      return head.trim().split("/").pop() ?? null;
    } catch {
      return null;
    }
  }
}

async function cmdValidate(args: Args): Promise<number> {
  const live = bool(args, "live");
  const statuses = await loadOrExit(
    live ? args : { ...args, flags: new Map([...args.flags, ["no-github", true]]) },
    { requireGithub: live }
  );
  let failed = printValidation(statuses);
  if (live) {
    for (const s of statuses) {
      const have = new Set(s.issues.map((i) => i.number));
      for (const item of s.roadmap.items) {
        for (const n of item.issues) {
          if (!have.has(n)) {
            console.log(
              `${s.file}: error L1 items[${item.id}].issues: #${n} not found in ${s.roadmap.meta.repo} (or is a pull request)`
            );
            failed = true;
          }
        }
        const r = s.rollup.items[item.id];
        if (item.status && item.status !== "dropped" && r && r.issues.length > 0) {
          console.log(
            `${s.file}: error L2 items[${item.id}].status: manual status but ${r.issues.length} issue(s) are linked via markers`
          );
          failed = true;
        }
      }
      for (const o of s.rollup.orphans)
        console.log(`${s.file}: warning L3 #${o.number}: ${o.kind} — ${o.detail}`);
    }
  }
  if (bool(args, "json"))
    console.log(
      JSON.stringify(
        statuses.map((s) => ({ file: s.file, ...s.validation })),
        null,
        2
      )
    );
  else if (!failed) {
    for (const s of statuses) {
      const w = s.validation.warnings.length;
      console.log(
        `${green("ok")} ${s.file} (${s.roadmap.items.length} items, ${s.roadmap.phases.length} phases${w ? `, ${w} warning(s)` : ""})`
      );
    }
  }
  return failed ? EXIT.error : EXIT.ok;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function colourStatus(s: string): string {
  switch (s) {
    case "done":
      return green(s);
    case "in-progress":
      return blue(s);
    case "blocked":
      return red(s);
    case "dropped":
      return dim(s);
    default:
      return yellow(s);
  }
}

async function cmdStatus(args: Args): Promise<number> {
  const statuses = await loadOrExit(args, { requireGithub: true });
  if (bool(args, "json")) {
    console.log(
      JSON.stringify(
        statuses.map((s) => toInternal(s.roadmap, s.rollup, s.file)),
        null,
        2
      )
    );
    return statuses.some((s) => s.validation.errors.length > 0) ? EXIT.error : EXIT.ok;
  }
  const failed = printValidation(statuses);
  for (const s of statuses) {
    const r = s.rollup;
    console.log(
      `\n${bold(s.roadmap.meta.project)} ${dim(s.file)} — ${s.roadmap.meta.repo} · current ${s.roadmap.meta.current_phase}${r.stale ? yellow(` · STALE (${r.staleReason})`) : ""}`
    );
    const rows = s.roadmap.items.map((it) => {
      const x = r.items[it.id];
      return [
        it.id,
        it.phase,
        x?.horizon ?? "",
        x?.status ?? "",
        String(x?.issues.length ?? 0),
        x?.because ?? "",
      ];
    });
    const widths = [0, 1, 2, 3, 4].map((c) =>
      Math.max(...rows.map((row) => (row[c] ?? "").length), 4)
    );
    console.log(
      dim(
        `${pad("item", widths[0] ?? 4)}  ${pad("phase", widths[1] ?? 5)}  ${pad("horizon", widths[2] ?? 7)}  ${pad("status", widths[3] ?? 6)}  ${pad("iss", widths[4] ?? 3)}  because`
      )
    );
    for (const row of rows) {
      const [id = "", phase = "", horizon = "", status = "", n = "", because = ""] = row;
      console.log(
        `${pad(id, widths[0] ?? 4)}  ${pad(phase, widths[1] ?? 5)}  ${pad(horizon, widths[2] ?? 7)}  ${pad(status, widths[3] ?? 6).replace(status, colourStatus(status))}  ${pad(n, widths[4] ?? 3)}  ${dim(because)}`
      );
    }
    for (const w of r.warnings) console.log(yellow(`  ! ${w}`));
    if (bool(args, "orphans") || r.orphans.length > 0) {
      for (const o of r.orphans)
        console.log(yellow(`  orphan #${o.number} ${o.kind}: ${o.detail} ${dim(o.url)}`));
    }
  }
  return failed ? EXIT.error : EXIT.ok;
}

async function cmdNext(args: Args): Promise<number> {
  const statuses = await loadOrExit(args, { requireGithub: true });
  const out = statuses.map((s) => ({
    project: s.roadmap.meta.project,
    stale: s.rollup.stale,
    frontier: frontier(s.roadmap, s.rollup, s.issues),
  }));
  if (bool(args, "json")) {
    console.log(
      JSON.stringify(
        out.map((o) => ({
          ...o,
          frontier: o.frontier.map((f) => ({
            item: f.item.id,
            status: f.status,
            horizon: f.horizon,
            unmet_dependencies: f.unmetDependencies,
            tasks: f.tasks.map((t) => ({
              id: t.task.id,
              title: t.task.title,
              clear: t.clear,
              blocked_by_issues: t.blockedByIssues,
              blocked_by_undispatched: t.blockedByUndispatched,
            })),
          })),
        })),
        null,
        2
      )
    );
    return EXIT.ok;
  }
  for (const o of out) {
    console.log(`\n${bold(o.project)}${o.stale ? yellow(" · STALE") : ""}`);
    if (o.frontier.length === 0) console.log(dim("  nothing in the current phase is open"));
    for (const f of o.frontier) {
      const deps = f.unmetDependencies.length
        ? red(` waits on ${f.unmetDependencies.join(", ")}`)
        : "";
      console.log(`  ${bold(f.item.id)} ${dim(`${f.horizon} · ${f.status}`)}${deps}`);
      for (const t of f.tasks) {
        const mark = t.clear ? green("→") : dim("·");
        const why = t.clear
          ? ""
          : dim(
              ` blocked by ${[...t.blockedByIssues.map((n) => `#${n}`), ...t.blockedByUndispatched].join(", ")}`
            );
        console.log(`    ${mark} ${t.task.id}: ${t.task.title}${why}`);
      }
      if (f.tasks.length === 0) console.log(dim("    all tasks dispatched"));
    }
  }
  return EXIT.ok;
}

async function fleetAllowlist(): Promise<string[] | null> {
  try {
    const cfg = JSON.parse(
      await fs.readFile(
        path.join(os.homedir(), ".local", "share", "fleetd", "fleetd.config.json"),
        "utf8"
      )
    ) as { allowlist?: string[] };
    return Array.isArray(cfg.allowlist) ? cfg.allowlist : null;
  } catch {
    return null;
  }
}

async function cmdDispatch(args: Args): Promise<number> {
  const itemId = args.positional[0];
  if (!itemId) fail(EXIT.usage, "usage: nextup dispatch <item-id> [--task id]… [--apply]");
  const token = resolveToken();
  if (!token)
    fail(EXIT.github, "dispatch needs a GitHub token (GH_TOKEN / GITHUB_TOKEN / gh auth login)");
  const statuses = await loadOrExit(args, { requireGithub: true });
  const withItem = statuses.filter((s) =>
    s.roadmap.items.some((it) => it.id === itemId || it.aliases.includes(itemId))
  );
  if (withItem.length === 0)
    fail(EXIT.usage, `no item "${itemId}" in ${statuses.map((s) => s.file).join(", ")}`);
  if (withItem.length > 1)
    fail(EXIT.usage, `item "${itemId}" exists in several roadmaps — pass --file`);
  const s = withItem[0];
  if (!s) return EXIT.usage;
  if (s.validation.errors.length > 0) {
    printValidation([s]);
    return EXIT.error;
  }
  if (s.rollup.stale) fail(EXIT.github, `cannot dispatch from stale data: ${s.rollup.staleReason}`);
  const client = createGitHubClient({
    token,
    cacheDir: path.join(process.cwd(), ".nextup", "cache"),
  });
  const labels = await client.listLabels(s.roadmap.meta.repo);
  const roadmap: Roadmap = s.roadmap;
  let plan: ReturnType<typeof planDispatch>;
  try {
    plan = planDispatch(
      roadmap,
      s.file,
      { labels, issues: s.issues },
      {
        itemId,
        tasks: str(args, "task")
          ?.split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        fleetEnv: str(args, "env") ?? null,
        autoMerge: bool(args, "auto-merge"),
        interactive: bool(args, "interactive"),
        forceFrontier: bool(args, "force-frontier"),
        fleetAllowlist: await fleetAllowlist(),
      }
    );
  } catch (e) {
    if (e instanceof DispatchRefused) fail(EXIT.refused, e.message);
    throw e;
  }
  if (!bool(args, "apply")) {
    if (bool(args, "json"))
      console.log(JSON.stringify({ dryRun: true, ...summarizePlan(plan) }, null, 2));
    else console.log(renderPlan(plan, roadmap));
    return EXIT.ok;
  }
  const result = await applyDispatch(plan, roadmap, client);
  if (bool(args, "json")) console.log(JSON.stringify({ dryRun: false, ...result }, null, 2));
  else {
    if (result.labelCreated) console.log(`${green("+")} label roadmap`);
    for (const c of result.created)
      console.log(`${green("+")} ${c.task}: #${c.number}${c.ready ? " READY" : ""} ${dim(c.url)}`);
    for (const k of result.skipped) console.log(`${dim("=")} ${k.task}: already #${k.issue}`);
    for (const w of plan.warnings) console.log(yellow(`! ${w}`));
    console.log(
      dim(
        `${result.created.length} created — fleetd picks up READY ones on its next tick; see /fleet`
      )
    );
  }
  return EXIT.ok;
}

function summarizePlan(plan: ReturnType<typeof planDispatch>) {
  return {
    item: plan.item.id,
    repo: plan.repo,
    create: plan.create.map((p) => ({
      task: p.task.id,
      title: p.title,
      labels: p.labels,
      blockedBy: p.blockedBy,
      blockedByPending: p.blockedByPending,
      ready: p.ready,
    })),
    skipped: plan.skipped.map((s) => ({ task: s.task.id, issue: s.issue })),
    needsLabel: plan.needsLabel,
    warnings: plan.warnings,
  };
}

async function cmdBuild(args: Args): Promise<number> {
  const audience = (str(args, "audience") ?? "public") as "public" | "internal";
  if (audience !== "public" && audience !== "internal")
    fail(EXIT.usage, "--audience must be public or internal");
  const out = str(args, "out") ?? path.join("dist", "roadmap");
  let statuses: LoadedStatus[];
  const estateFile = str(args, "estate");
  if (estateFile) {
    const parsed = parseEstate(
      await fs
        .readFile(estateFile, "utf8")
        .catch(() => fail(EXIT.usage, `cannot read ${estateFile}`))
    );
    if (!parsed.ok)
      fail(
        EXIT.usage,
        `${estateFile}: ${parsed.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`
      );
    const token = resolveToken();
    if (!token) fail(EXIT.github, "estate build needs a GitHub token");
    try {
      statuses = await loadStatus({
        cwd: process.cwd(),
        estate: parsed.value,
        fleetStatePath: fleetStatePath(args),
        token,
      });
    } catch (e) {
      if (e instanceof LoadError) fail(e.code, e.message);
      throw e;
    }
  } else {
    statuses = await loadOrExit(args);
  }
  if (printValidation(statuses)) return EXIT.error;
  try {
    const report = await writeBuild(statuses, {
      audience,
      out,
      site: bool(args, "site"),
      check: bool(args, "check"),
    });
    for (const r of report.refused) console.log(yellow(`skip ${r.project}: ${r.reason}`));
    if (bool(args, "check")) {
      if (report.drift.length > 0) {
        for (const d of report.drift) console.log(red(`drift ${d}`));
        return EXIT.error;
      }
      console.log(green("no drift"));
      return report.refused.length > 0 && statuses.length === report.refused.length
        ? EXIT.refused
        : EXIT.ok;
    }
    for (const w of report.written) console.log(`${green("wrote")} ${path.join(out, w)}`);
    const stale = statuses.filter((s) => s.rollup.stale);
    if (stale.length > 0)
      console.log(
        yellow(
          `stale: ${stale.map((s) => `${s.roadmap.meta.project} (${s.rollup.staleReason})`).join(", ")}`
        )
      );
    if (report.refused.length === statuses.length) return EXIT.refused;
    return EXIT.ok;
  } catch (e) {
    if (e instanceof LoadError) fail(e.code, e.message);
    throw e;
  }
}

async function cmdServe(args: Args): Promise<number> {
  const port = Number(str(args, "port") ?? 4177);
  if (!Number.isInteger(port) || port <= 0) fail(EXIT.usage, "--port must be a positive integer");
  const server = createServer({
    port,
    cwd: process.cwd(),
    staticDir: str(args, "static"),
    fleetStatePath: fleetStatePath(args),
  });
  const url = await listen(server, port);
  console.log(
    `${green("nextup serve")} ${url} ${dim(str(args, "static") ? `(static ${str(args, "static")})` : "(internal view, live)")}`
  );
  await new Promise(() => {
    // run until killed
  });
  return EXIT.ok;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (
    !args.command ||
    args.command === "help" ||
    args.command === "--help" ||
    args.command === "-h" ||
    bool(args, "help")
  ) {
    console.log(HELP);
    process.exit(EXIT.ok);
  }
  let code: number;
  switch (args.command) {
    case "init":
      code = await cmdInit(args);
      break;
    case "validate":
      code = await cmdValidate(args);
      break;
    case "status":
      code = await cmdStatus(args);
      break;
    case "next":
      code = await cmdNext(args);
      break;
    case "dispatch":
      code = await cmdDispatch(args);
      break;
    case "build":
      code = await cmdBuild(args);
      break;
    case "serve":
      code = await cmdServe(args);
      break;
    case "mcp":
      await serveMcp({ cwd: process.cwd() });
      return;
    default:
      console.error(red(`unknown command "${args.command}"`));
      console.log(HELP);
      code = EXIT.usage;
  }
  process.exit(code);
}

main().catch((e) => {
  console.error(red(e instanceof Error ? (e.stack ?? e.message) : String(e)));
  process.exit(EXIT.error);
});
