/**
 * The one place that talks to GitHub.
 *
 * A thin fetch client, not an SDK: five endpoints, conditional requests with
 * ETags so a 15-minute rebuild of an unchanged repo costs nothing against the
 * rate limit, and Link-header pagination. Every method takes `owner/name` so
 * one client serves an estate build across repos.
 *
 * Token discovery lives in `token.ts` (it spawns `gh`); this module is fetch-only so
 * the read-only barrel can export it without dragging in child_process.
 *
 * `GitHubClient` is an interface on purpose. `dispatch.test.ts` drives the
 * dispatcher with a fake that records what would have been created; nothing in
 * the test suite reaches the network.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROADMAP_LABEL } from "./markers";
import type { IssueSnapshot, Roadmap } from "./types";

export const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Unix seconds when the rate limit resets, when that is the cause. */
    readonly rateLimitReset: number | null = null
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface CreateIssueInput {
  title: string;
  body: string;
  labels: string[];
}

export interface GitHubClient {
  listIssues(
    repo: string,
    opts: { labels?: string[]; state?: "open" | "closed" | "all" }
  ): Promise<IssueSnapshot[]>;
  getIssue(repo: string, number: number): Promise<IssueSnapshot | null>;
  listLabels(repo: string): Promise<string[]>;
  createLabel(repo: string, name: string, color: string, description: string): Promise<void>;
  createIssue(repo: string, input: CreateIssueInput): Promise<{ number: number; url: string }>;
  /** Decoded file content at `ref` (default branch when omitted), or null when missing. */
  getFileContent(repo: string, filePath: string, ref?: string): Promise<string | null>;
}

interface CacheEntry {
  etag: string;
  body: unknown;
  /** Response headers we need to reuse (Link) when serving from cache. */
  link: string | null;
}

export interface ClientOptions {
  token: string;
  /** Directory for the ETag cache; omit for in-memory only. */
  cacheDir?: string;
  fetch?: typeof fetch;
  userAgent?: string;
}

export function createGitHubClient(options: ClientOptions): GitHubClient {
  const doFetch = options.fetch ?? fetch;
  const memory = new Map<string, CacheEntry>();
  const ua = options.userAgent ?? "nextup (+https://github.com/hansenexus/nextup)";

  const cachePath = (url: string) =>
    options.cacheDir
      ? path.join(options.cacheDir, `${createHash("sha1").update(url).digest("hex")}.json`)
      : null;

  async function readCache(url: string): Promise<CacheEntry | null> {
    const hit = memory.get(url);
    if (hit) return hit;
    const p = cachePath(url);
    if (!p) return null;
    try {
      const entry = JSON.parse(await fs.readFile(p, "utf8")) as CacheEntry;
      memory.set(url, entry);
      return entry;
    } catch {
      return null;
    }
  }

  async function writeCache(url: string, entry: CacheEntry): Promise<void> {
    memory.set(url, entry);
    const p = cachePath(url);
    if (!p) return;
    try {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, JSON.stringify(entry));
    } catch {
      // cache is best-effort
    }
  }

  async function request<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<{ data: T; link: string | null }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": ua,
    };
    const cached = method === "GET" ? await readCache(url) : null;
    if (cached) headers["If-None-Match"] = cached.etag;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await doFetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 304 && cached) return { data: cached.body as T, link: cached.link };
    if (res.status === 404 && method === "GET") throw new GitHubError(`404 ${url}`, 404);
    if (!res.ok) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      const reset = res.headers.get("x-ratelimit-reset");
      const text = await res.text().catch(() => "");
      if ((res.status === 403 || res.status === 429) && remaining === "0") {
        throw new GitHubError(
          `rate limited until ${reset ? new Date(Number(reset) * 1000).toISOString() : "?"}`,
          res.status,
          reset ? Number(reset) : null
        );
      }
      throw new GitHubError(`${res.status} ${method} ${url}: ${text.slice(0, 200)}`, res.status);
    }
    const data = (res.status === 204 ? null : await res.json()) as T;
    const link = res.headers.get("link");
    const etag = res.headers.get("etag");
    if (method === "GET" && etag) await writeCache(url, { etag, body: data, link });
    return { data, link };
  }

  function nextPage(link: string | null): string | null {
    if (!link) return null;
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    return m?.[1] ?? null;
  }

  async function paginate<T>(url: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = url;
    let pages = 0;
    while (next && pages < 50) {
      const res: { data: T[]; link: string | null } = await request<T[]>("GET", next);
      out.push(...res.data);
      next = nextPage(res.link);
      pages++;
    }
    return out;
  }

  interface RawIssue {
    number: number;
    title: string;
    state: "open" | "closed";
    labels: Array<{ name: string } | string>;
    body: string | null;
    html_url: string;
    pull_request?: unknown;
    updated_at?: string;
  }

  const toSnapshot = (raw: RawIssue): IssueSnapshot => ({
    number: raw.number,
    title: raw.title,
    state: raw.state,
    labels: raw.labels.map((l) => (typeof l === "string" ? l : l.name)),
    body: raw.body ?? "",
    url: raw.html_url,
    isPullRequest: raw.pull_request !== undefined,
    updatedAt: raw.updated_at,
  });

  return {
    async listIssues(repo, opts) {
      const params = new URLSearchParams({ state: opts.state ?? "all", per_page: "100" });
      if (opts.labels && opts.labels.length > 0) params.set("labels", opts.labels.join(","));
      const raws = await paginate<RawIssue>(`${API}/repos/${repo}/issues?${params}`);
      return raws.map(toSnapshot);
    },
    async getIssue(repo, number) {
      try {
        const { data } = await request<RawIssue>("GET", `${API}/repos/${repo}/issues/${number}`);
        return toSnapshot(data);
      } catch (e) {
        if (e instanceof GitHubError && e.status === 404) return null;
        throw e;
      }
    },
    async listLabels(repo) {
      const raws = await paginate<{ name: string }>(`${API}/repos/${repo}/labels?per_page=100`);
      return raws.map((l) => l.name);
    },
    async createLabel(repo, name, color, description) {
      await request("POST", `${API}/repos/${repo}/labels`, { name, color, description });
    },
    async createIssue(repo, input) {
      const { data } = await request<RawIssue>("POST", `${API}/repos/${repo}/issues`, input);
      return { number: data.number, url: data.html_url };
    },
    async getFileContent(repo, filePath, ref) {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      try {
        const { data } = await request<{ content?: string; encoding?: string }>(
          "GET",
          `${API}/repos/${repo}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}${q}`
        );
        if (!data.content) return null;
        return Buffer.from(
          data.content.replace(/\n/g, ""),
          data.encoding === "base64" ? "base64" : "utf8"
        ).toString("utf8");
      } catch (e) {
        if (e instanceof GitHubError && e.status === 404) return null;
        throw e;
      }
    },
  };
}

/**
 * The issues a rollup needs: everything labelled `roadmap` (filtered to the
 * scope label when the roadmap has one) plus any hand-linked numbers that lack
 * the label. Two calls for a hundred issues, one more per unlabelled link.
 */
export async function fetchRoadmapIssues(
  client: GitHubClient,
  roadmap: Roadmap
): Promise<IssueSnapshot[]> {
  const scope = roadmap.meta.scope.label;
  const labelled = await client.listIssues(roadmap.meta.repo, {
    labels: [ROADMAP_LABEL],
    state: "all",
  });
  const issues = labelled.filter((i) => !i.isPullRequest && (!scope || i.labels.includes(scope)));
  const have = new Set(issues.map((i) => i.number));
  for (const item of roadmap.items) {
    for (const n of item.issues) {
      if (have.has(n)) continue;
      const issue = await client.getIssue(roadmap.meta.repo, n);
      if (issue && !issue.isPullRequest) {
        issues.push(issue);
        have.add(n);
      }
    }
  }
  return issues;
}
