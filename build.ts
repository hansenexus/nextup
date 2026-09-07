/**
 * Loading a roadmap WITH its status, and writing the projections out.
 *
 * `loadStatus` is the shared entry for `status`, `next`, `build`, `serve` and
 * `mcp`: locate the file(s), validate, fetch issues when a token exists, read
 * wave files and fleet lanes, roll up. When GitHub is unreachable the result
 * is marked `stale` with a reason instead of failing — a Pages build must
 * publish yesterday's truth rather than nothing, and it must SAY so.
 *
 * `writeBuild` emits JSON and, with `site: true`, a static page. The public
 * projection refuses to leave when `meta.public` is false, and an internal
 * projection refuses to land in a directory whose path says `pages` or
 * `public`. Both refusals are the cheap half of "never leak internals".
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { loadFleetState } from "./fleet-state";
import { createGitHubClient, fetchRoadmapIssues, type GitHubClient, GitHubError } from "./github";
import {
  CONFIG_FILENAME,
  type LoadedRoadmap,
  loadAll,
  loadRoadmap,
  locate,
  parseRoadmap,
} from "./load";
import { loadWaves } from "./mechanics-waves";
import { toInternal, toPublic } from "./project";
import { rollup } from "./rollup";
import { resolveToken } from "./token";
import type {
  EstateConfig,
  IssueSnapshot,
  Roadmap,
  Rollup,
  ValidationResult,
  WaveSummary,
} from "./types";
import { validateRoadmap } from "./validate";

export interface LoadedStatus {
  /** Repo root when loaded from disk; null for estate (GitHub) loads. */
  root: string | null;
  /** Repo-relative roadmap path. */
  file: string;
  roadmap: Roadmap;
  validation: ValidationResult;
  issues: IssueSnapshot[];
  rollup: Rollup;
}

export interface LoadStatusOptions {
  cwd: string;
  /** Explicit roadmap file; otherwise located from cwd. */
  file?: string;
  /** Load every roadmap the config lists. Default: the located set anyway. */
  all?: boolean;
  /** Estate mode: fetch roadmaps from GitHub, no checkouts. */
  estate?: EstateConfig;
  fleetStatePath?: string | null;
  /** Skip GitHub entirely (stale output). */
  noGithub?: boolean;
  token?: string | null;
  cacheDir?: string;
  client?: GitHubClient;
  today?: string;
  now?: Date;
}

export class LoadError extends Error {
  constructor(
    message: string,
    readonly code: 1 | 2 | 3 | 4
  ) {
    super(message);
    this.name = "LoadError";
  }
}

async function resolveClient(
  options: LoadStatusOptions
): Promise<{ client: GitHubClient | null; staleReason: string | null }> {
  if (options.client) return { client: options.client, staleReason: null };
  if (options.noGithub) return { client: null, staleReason: "no-github (requested)" };
  const token = options.token ?? resolveToken();
  if (!token) return { client: null, staleReason: "no-github-token" };
  const cacheDir = options.cacheDir ?? path.join(options.cwd, ".nextup", "cache");
  return { client: createGitHubClient({ token, cacheDir }), staleReason: null };
}

async function issuesFor(
  client: GitHubClient | null,
  roadmap: Roadmap
): Promise<{ issues: IssueSnapshot[]; stale: { reason: string } | null }> {
  if (!client) return { issues: [], stale: null };
  try {
    return { issues: await fetchRoadmapIssues(client, roadmap), stale: null };
  } catch (e) {
    const reason =
      e instanceof GitHubError ? `github ${e.status}: ${e.message}` : `github: ${String(e)}`;
    return { issues: [], stale: { reason } };
  }
}

export async function loadStatus(options: LoadStatusOptions): Promise<LoadedStatus[]> {
  const { client, staleReason } = await resolveClient(options);
  const out: LoadedStatus[] = [];

  const sources: Array<LoadedRoadmap & { root: string | null }> = [];
  if (options.estate) {
    if (!client) throw new LoadError(`estate build needs a GitHub token (${staleReason})`, 3);
    for (const entry of options.estate.repos) {
      for (const file of entry.files) {
        const text = await client.getFileContent(entry.repo, file, entry.ref);
        if (text === null) throw new LoadError(`${entry.repo}: ${file} not found`, 1);
        const parsed = parseRoadmap(text);
        if (!parsed.ok)
          throw new LoadError(
            `${entry.repo}/${file}: ${parsed.errors.map((f) => `${f.path}: ${f.message}`).join("; ")}`,
            1
          );
        sources.push({
          file,
          absolute: `${entry.repo}/${file}`,
          roadmap: parsed.value,
          root: null,
        });
      }
    }
  } else if (options.file) {
    const absolute = path.resolve(options.cwd, options.file);
    const parsed = await loadRoadmap(absolute);
    if (!parsed.ok)
      throw new LoadError(
        `${options.file}: ${parsed.errors.map((f) => `${f.path}: ${f.message}`).join("; ")}`,
        parsed.errors[0]?.rule === "V0" ? 2 : 1
      );
    const located = await locate(path.dirname(absolute));
    const root = located?.root ?? path.dirname(absolute);
    sources.push({
      file: path.relative(root, absolute).split(path.sep).join("/"),
      absolute,
      roadmap: parsed.value,
      root,
    });
  } else {
    const located = await locate(options.cwd);
    if (!located)
      throw new LoadError(
        `no roadmap.yaml or ${CONFIG_FILENAME} found from ${options.cwd} upwards`,
        2
      );
    const all = await loadAll(located);
    if (all.failed.length > 0) {
      const msg = all.failed
        .map((f) => `${f.file}: ${f.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`)
        .join("\n");
      throw new LoadError(msg, 1);
    }
    for (const l of all.loaded) sources.push({ ...l, root: located.root });
  }

  for (const src of sources) {
    const validation = await validateRoadmap(src.roadmap, {
      root: src.root ?? undefined,
      today: options.today,
    });
    const { issues, stale } = await issuesFor(client, src.roadmap);
    let waves: Record<string, WaveSummary> = {};
    if (src.root && src.roadmap.meta.mechanics_waves) {
      const names = src.roadmap.items
        .map((it) => it.mechanics_wave)
        .filter((w): w is string => Boolean(w));
      waves = await loadWaves(src.root, src.roadmap.meta.mechanics_waves, names);
    }
    const lanes = options.fleetStatePath
      ? await loadFleetState(options.fleetStatePath, src.roadmap.meta.repo)
      : [];
    const roll = rollup({
      roadmap: src.roadmap,
      file: src.file,
      issues,
      lanes,
      waves,
      stale: stale ?? (client ? null : { reason: staleReason ?? "no-github" }),
      now: options.now,
    });
    out.push({
      root: src.root,
      file: src.file,
      roadmap: src.roadmap,
      validation,
      issues,
      rollup: roll,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

export type Audience = "public" | "internal";

export interface BuildOptions {
  audience: Audience;
  out: string;
  site?: boolean;
  /** Compare against existing output instead of writing; report drift. */
  check?: boolean;
}

export interface BuildReport {
  written: string[];
  /** Projects refused (public build of a non-public roadmap). */
  refused: Array<{ project: string; reason: string }>;
  /** Files whose committed content differs (check mode). */
  drift: string[];
}

export interface IndexEntry {
  project: string;
  title: unknown;
  path: string;
  version: number;
  updated: string;
  stale: boolean;
  audience: Audience;
}

const LEAKY_DIRS = new Set(["pages", "public", "gh-pages", "docs"]);

export function guardInternalOut(out: string): string | null {
  const segments = path
    .resolve(out)
    .split(path.sep)
    .map((s) => s.toLowerCase());
  const hit = segments.find((s) => LEAKY_DIRS.has(s));
  return hit
    ? `refusing to write an internal projection under a directory named "${hit}" — that is where public sites are served from`
    : null;
}

function stripGenerated(text: string): string {
  return text.replace(/"generated_at":\s*"[^"]*"/g, '"generated_at":""');
}

export function projectionFor(status: LoadedStatus, audience: Audience): unknown {
  return audience === "public"
    ? toPublic(status.roadmap, status.rollup)
    : toInternal(status.roadmap, status.rollup, status.file);
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

/** Where the package's own assets live, whether running from source or from dist/. */
export async function packageAsset(rel: string): Promise<string | null> {
  const here = path.dirname(new URL(import.meta.url).pathname);
  for (const base of [here, path.join(here, ".."), path.join(here, "..", "..")]) {
    const candidate = path.join(base, rel);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // next
    }
  }
  return null;
}

export async function writeBuild(
  statuses: LoadedStatus[],
  options: BuildOptions
): Promise<BuildReport> {
  const report: BuildReport = { written: [], refused: [], drift: [] };
  if (options.audience === "internal") {
    const guard = guardInternalOut(options.out);
    if (guard) throw new LoadError(guard, 4);
  }
  const eligible = statuses.filter((s) => {
    if (options.audience === "public" && !s.roadmap.meta.public) {
      report.refused.push({ project: s.roadmap.meta.project, reason: "meta.public is false" });
      return false;
    }
    return true;
  });
  const single = eligible.length === 1;
  const fileName = options.audience === "public" ? "roadmap.public.json" : "roadmap.internal.json";
  const entries: IndexEntry[] = [];
  const writes: Array<{ file: string; text: string }> = [];

  for (const s of eligible) {
    const projection = projectionFor(s, options.audience);
    const rel = single ? fileName : path.join(s.roadmap.meta.project, fileName);
    writes.push({
      file: path.join(options.out, rel),
      text: `${JSON.stringify(projection, null, 2)}\n`,
    });
    entries.push({
      project: s.roadmap.meta.project,
      title: s.roadmap.meta.title,
      path: rel.split(path.sep).join("/"),
      version: s.roadmap.meta.version,
      updated: s.roadmap.meta.updated,
      stale: s.rollup.stale,
      audience: options.audience,
    });
  }
  writes.push({
    file: path.join(options.out, "index.json"),
    text: `${JSON.stringify(entries, null, 2)}\n`,
  });

  if (options.site) {
    const template = await packageAsset("site-template/index.html");
    const bundle = await packageAsset("dist/wc/nextup-roadmap.iife.js");
    if (!template) throw new LoadError("site-template/index.html not found in package", 2);
    if (!bundle)
      throw new LoadError("dist/wc/nextup-roadmap.iife.js not built — run `bun run build:wc`", 2);
    const html = (await fs.readFile(template, "utf8")).replaceAll("__AUDIENCE__", options.audience);
    writes.push({ file: path.join(options.out, "index.html"), text: html });
    writes.push({
      file: path.join(options.out, "nextup-roadmap.iife.js"),
      text: await fs.readFile(bundle, "utf8"),
    });
    writes.push({ file: path.join(options.out, ".nojekyll"), text: "" });
  }

  for (const w of writes) {
    if (options.check) {
      const existing = await readIfExists(w.file);
      if (existing === null || stripGenerated(existing) !== stripGenerated(w.text))
        report.drift.push(path.relative(options.out, w.file));
      continue;
    }
    await fs.mkdir(path.dirname(w.file), { recursive: true });
    await fs.writeFile(w.file, w.text);
    report.written.push(path.relative(options.out, w.file));
  }
  return report;
}
