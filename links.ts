/**
 * Item links, resolved against the roadmap's repository.
 *
 * A `links[].url` in roadmap.yaml is written from the repo's point of view —
 * `docs/design/blueprint-module.md` — but rendered on a consumer's site, where
 * a relative href resolves against THAT site's origin and 404s. So both
 * projections resolve every relative link before it leaves:
 *
 *   docs/PLAN.md#phasing  →  https://github.com/<owner>/<name>/blob/HEAD/docs/PLAN.md#phasing
 *
 * `HEAD` on purpose, not the default branch: GitHub resolves it server-side,
 * so the output is identical with and without a token, and `build --check`
 * never reports drift because someone renamed `master` to `main`.
 *
 * Untouched: anything with a scheme (`https:`, `mailto:`, `tel:` …),
 * protocol-relative `//host/…`, and a bare `#fragment`. Dropped — and flagged
 * by `validate` as V15 — is what cannot resolve: a path that climbs out of
 * the repo (`../x`), a query-only `?x`, or any relative link when no repo is
 * known. A link that cannot resolve is worse than no link.
 *
 * Pure and node-free so the renderers' dependency graph stays browser-safe.
 */

import type { Link } from "./types";

/** The ref relative links resolve to. GitHub maps it to the default branch. */
export const GITHUB_LINK_REF = "HEAD";

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** `a/./b/../c/` → `a/c`; null when the path climbs above the root or is empty. */
function normalizeRepoPath(p: string): string | null {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length === 0 ? null : out.join("/");
}

/**
 * The href a renderer may emit for `url`, or null when there is none to emit.
 * `repo` is `owner/name`; null means "unknown", which drops every relative link.
 */
export function resolveLink(url: string, repo: string | null): string | null {
  if (url === "") return null;
  if (SCHEME_RE.test(url) || url.startsWith("//") || url.startsWith("#")) return url;
  if (url.startsWith("?")) return null;
  if (!repo) return null;
  const hash = url.indexOf("#");
  const fragment = hash >= 0 ? url.slice(hash) : "";
  const beforeHash = hash >= 0 ? url.slice(0, hash) : url;
  const q = beforeHash.indexOf("?");
  const query = q >= 0 ? beforeHash.slice(q) : "";
  const rawPath = q >= 0 ? beforeHash.slice(0, q) : beforeHash;
  const repoPath = normalizeRepoPath(rawPath);
  if (repoPath === null) return null;
  return `https://github.com/${repo}/blob/${GITHUB_LINK_REF}/${repoPath}${query}${fragment}`;
}

/** The links a projection ships: resolved, with the unresolvable ones dropped. */
export function resolveLinks(links: readonly Link[], repo: string | null): Link[] {
  const out: Link[] = [];
  for (const l of links) {
    const url = resolveLink(l.url, repo);
    if (url !== null) out.push({ title: l.title, url });
  }
  return out;
}
