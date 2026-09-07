/**
 * Where the GitHub token comes from, in order: `NEXTUP_GITHUB_TOKEN`,
 * `GH_TOKEN`, `GITHUB_TOKEN`, then `gh auth token` when `gh` is on PATH.
 * The last step is what a developer laptop has; CI has GITHUB_TOKEN. Kept out
 * of `github.ts` so the barrel stays free of child_process.
 */

import { spawnSync } from "node:child_process";

export function resolveToken(env: NodeJS.ProcessEnv = process.env, allowGh = true): string | null {
  for (const key of ["NEXTUP_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]) {
    const v = env[key]?.trim();
    if (v) return v;
  }
  // `NEXTUP_NO_GH=1` makes a run hermetic: no keychain-backed `gh` token sneaks in.
  if (!allowGh || env.NEXTUP_NO_GH) return null;
  try {
    const res = spawnSync("gh", ["auth", "token"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const out = res.stdout?.trim();
    if (res.status === 0 && out) return out;
  } catch {
    // gh missing or slow — fall through
  }
  return null;
}
