/**
 * Finding and parsing roadmap files.
 *
 * `roadmap.yaml` is looked up from the working directory upwards, the way
 * `package.json` is; a `nextup.config.yaml` at a repo root lists several
 * roadmaps (monorepo) and wins the walk when it is found first. Parsing
 * returns a discriminated union rather than throwing, so callers cannot
 * forget the failure branch: a yaml typo in one app's roadmap must not take
 * the estate build down with it.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { z } from "zod";
import { configSchema, estateSchema, roadmapSchema } from "./schema";
import type { EstateConfig, Finding, NextupConfig, Roadmap, Skin } from "./types";

export const ROADMAP_FILENAME = "roadmap.yaml";
export const CONFIG_FILENAME = "nextup.config.yaml";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: Finding[] };

function zodFindings(error: z.ZodError, rule: string): Finding[] {
  return error.issues.map((issue) => ({
    rule,
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
}

/** Parse yaml text into a Roadmap, applying defaults. Rule V1 = shape. */
export function parseRoadmap(text: string): ParseResult<Roadmap> {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ rule: "V1", path: "(root)", message: `yaml: ${String(e)}` }] };
  }
  const parsed = roadmapSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: zodFindings(parsed.error, "V1") };
  return { ok: true, value: parsed.data };
}

export function parseConfig(text: string): ParseResult<NextupConfig> {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ rule: "C1", path: "(root)", message: `yaml: ${String(e)}` }] };
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: zodFindings(parsed.error, "C1") };
  return { ok: true, value: parsed.data };
}

export function parseEstate(text: string): ParseResult<EstateConfig> {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ rule: "E1", path: "(root)", message: `yaml: ${String(e)}` }] };
  }
  const parsed = estateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: zodFindings(parsed.error, "E1") };
  return { ok: true, value: parsed.data };
}

export async function loadRoadmap(file: string): Promise<ParseResult<Roadmap>> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (e) {
    return {
      ok: false,
      errors: [{ rule: "V0", path: file, message: `cannot read: ${String(e)}` }],
    };
  }
  return parseRoadmap(text);
}

export interface Located {
  /** Directory that holds the roadmap or config — the repo root for markers. */
  root: string;
  /** Roadmap files, relative to `root`, in config order. */
  files: string[];
  /** Which file decided the walk. */
  via: "config" | "roadmap";
  /** Host skins for the serve harness; empty unless a config declared them. */
  skins: Skin[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk up from `cwd`. A `nextup.config.yaml` anywhere above wins over a nearer
 * `roadmap.yaml`, so running inside `apps/alpha` of a monorepo still sees the
 * whole set (narrow with `--file`). Only when no config exists does the
 * nearest `roadmap.yaml` decide.
 */
export async function locate(cwd: string): Promise<Located | null> {
  const start = path.resolve(cwd);
  const ancestors: string[] = [];
  for (let dir = start; ; dir = path.dirname(dir)) {
    ancestors.push(dir);
    if (path.dirname(dir) === dir) break;
  }
  for (const dir of ancestors) {
    const cfg = path.join(dir, CONFIG_FILENAME);
    if (!(await exists(cfg))) continue;
    const parsed = parseConfig(await fs.readFile(cfg, "utf8"));
    if (parsed.ok) {
      const files = await expandGlobs(dir, parsed.value.roadmaps);
      return { root: dir, files, via: "config", skins: parsed.value.skins ?? [] };
    }
  }
  for (const dir of ancestors) {
    if (await exists(path.join(dir, ROADMAP_FILENAME))) {
      return { root: dir, files: [ROADMAP_FILENAME], via: "roadmap", skins: [] };
    }
  }
  return null;
}

/**
 * Minimal glob: `*` matches one path segment (never `/`). That covers
 * `apps/*\/roadmap.yaml` and `roadmap.yaml`; anything fancier is a
 * config-file mistake worth surfacing rather than guessing at.
 */
export async function expandGlobs(root: string, patterns: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const pattern of patterns) {
    for (const match of await expandOne(root, pattern.split("/"))) {
      if (!out.includes(match)) out.push(match);
    }
  }
  return out;
}

async function expandOne(root: string, segments: string[], prefix = ""): Promise<string[]> {
  if (segments.length === 0) return (await exists(path.join(root, prefix))) ? [prefix] : [];
  const [head, ...rest] = segments;
  if (head === undefined) return [];
  if (!head.includes("*")) return expandOne(root, rest, prefix ? `${prefix}/${head}` : head);
  const dir = path.join(root, prefix);
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isDirectory() || rest.length === 0)
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
  const re = new RegExp(`^${head.split("*").map(escapeRe).join("[^/]*")}$`);
  const results: string[] = [];
  for (const name of entries) {
    if (!re.test(name)) continue;
    results.push(...(await expandOne(root, rest, prefix ? `${prefix}/${name}` : name)));
  }
  return results;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface LoadedRoadmap {
  /** Repo-relative path, forward slashes — what markers carry. */
  file: string;
  absolute: string;
  roadmap: Roadmap;
}

export interface LoadAllResult {
  root: string;
  loaded: LoadedRoadmap[];
  failed: Array<{ file: string; errors: Finding[] }>;
}

export async function loadAll(located: Located): Promise<LoadAllResult> {
  const loaded: LoadedRoadmap[] = [];
  const failed: LoadAllResult["failed"] = [];
  for (const file of located.files) {
    const absolute = path.join(located.root, file);
    const parsed = await loadRoadmap(absolute);
    if (parsed.ok)
      loaded.push({ file: file.split(path.sep).join("/"), absolute, roadmap: parsed.value });
    else failed.push({ file, errors: parsed.errors });
  }
  return { root: located.root, loaded, failed };
}
