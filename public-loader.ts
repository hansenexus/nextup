/**
 * `loadPublicRoadmap` — what a site calls at build time.
 *
 *   const data = await loadPublicRoadmap({ url: "https://…/roadmap.public.json" });
 *   const data = await loadPublicRoadmap({ file: "apps/lexilink-next/roadmap.yaml", token: process.env.GITHUB_TOKEN });
 *
 * `url` fetches an already-published projection and checks its shape. `file`
 * reads the yaml in this repo, rolls status up from GitHub when a token is
 * given (stale otherwise) and projects it — same-repo sites need no Pages
 * hop. Either way the result is validated against `publicRoadmapSchema`, so a
 * page never renders a half-written feed. No child_process anywhere here.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createGitHubClient, fetchRoadmapIssues, type GitHubClient, GitHubError } from "./github";
import { parseRoadmap } from "./load";
import { toPublic } from "./project";
import { rollup } from "./rollup";
import { publicRoadmapSchema } from "./schema";
import type { PublicRoadmap } from "./types";
import { validateRoadmap } from "./validate";

export interface LoadPublicOptions {
  url?: string;
  file?: string;
  token?: string | null;
  client?: GitHubClient;
  fetch?: typeof fetch;
  /** Relative path base for `file`; default process.cwd(). */
  cwd?: string;
}

export async function loadPublicRoadmap(options: LoadPublicOptions): Promise<PublicRoadmap> {
  if (options.url) {
    const doFetch = options.fetch ?? fetch;
    const res = await doFetch(options.url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`loadPublicRoadmap: ${res.status} ${options.url}`);
    return publicRoadmapSchema.parse(await res.json());
  }
  if (!options.file) throw new Error("loadPublicRoadmap: pass `url` or `file`");
  const absolute = path.resolve(options.cwd ?? process.cwd(), options.file);
  const parsed = parseRoadmap(await fs.readFile(absolute, "utf8"));
  if (!parsed.ok)
    throw new Error(
      `loadPublicRoadmap: ${options.file}: ${parsed.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`
    );
  const roadmap = parsed.value;
  if (!roadmap.meta.public)
    throw new Error(`loadPublicRoadmap: ${options.file} has meta.public: false`);
  const validation = await validateRoadmap(roadmap);
  if (validation.errors.length > 0) {
    throw new Error(
      `loadPublicRoadmap: ${options.file}: ${validation.errors.map((e) => `${e.rule} ${e.path}: ${e.message}`).join("; ")}`
    );
  }
  const client =
    options.client ?? (options.token ? createGitHubClient({ token: options.token }) : null);
  let issues: Awaited<ReturnType<typeof fetchRoadmapIssues>> = [];
  let stale: { reason: string } | null = client ? null : { reason: "no-github-token" };
  if (client) {
    try {
      issues = await fetchRoadmapIssues(client, roadmap);
    } catch (e) {
      stale = { reason: e instanceof GitHubError ? `github ${e.status}` : String(e) };
    }
  }
  const roll = rollup({ roadmap, file: options.file.split(path.sep).join("/"), issues, stale });
  return publicRoadmapSchema.parse(toPublic(roadmap, roll));
}
