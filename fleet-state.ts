/**
 * Read fleetd's state file (`~/.claude/fleet/state.json`, schema 1) for the
 * one thing the rollup wants from it: which issues currently have a lane.
 *
 * Lane records look like
 *   { repo: "owner/name", issue: 123, name, runtime, worktree_id, branch, phase, retries }
 * Anything else is ignored; an unreadable or foreign-schema file yields no
 * lanes rather than an error, because lane info is enrichment, not truth —
 * labels already say `status:in-progress`.
 */

import { promises as fs } from "node:fs";
import type { Lane } from "./types";

interface RawState {
  schema?: number;
  updated_at?: string;
  lanes?: Array<Record<string, unknown>>;
}

export function parseFleetState(text: string, repo?: string): Lane[] {
  let raw: RawState;
  try {
    raw = JSON.parse(text) as RawState;
  } catch {
    return [];
  }
  if (raw.schema !== 1 || !Array.isArray(raw.lanes)) return [];
  const lanes: Lane[] = [];
  for (const r of raw.lanes) {
    const issue = typeof r.issue === "number" ? r.issue : Number(r.issue);
    if (!Number.isInteger(issue)) continue;
    const laneRepo = typeof r.repo === "string" ? r.repo : undefined;
    if (repo && laneRepo && laneRepo !== repo) continue;
    lanes.push({
      issue,
      repo: laneRepo,
      runtime: typeof r.runtime === "string" ? r.runtime : undefined,
      phase: typeof r.phase === "string" ? r.phase : undefined,
      updatedAt: raw.updated_at,
    });
  }
  return lanes;
}

export async function loadFleetState(file: string, repo?: string): Promise<Lane[]> {
  try {
    return parseFleetState(await fs.readFile(file, "utf8"), repo);
  } catch {
    return [];
  }
}
