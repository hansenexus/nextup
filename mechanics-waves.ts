/**
 * Read `@hansenexus/mechanics` wave files — without depending on the package.
 * The shape is tiny and stable: `wave`, `status`, and `verifications[]` each
 * with a `status` of pass | fail | blocked | n-a. "Settled" means pass or n-a:
 * nothing left to prove. An item whose `mechanics_wave` is not settled cannot
 * be `done`, however many issues are closed.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { WaveSummary } from "./types";

interface RawWave {
  wave?: string;
  status?: string;
  verifications?: Array<{ status?: string }>;
}

export function summarizeWaveText(text: string, fallbackName: string): WaveSummary | null {
  let raw: RawWave;
  try {
    raw = (YAML.parse(text) ?? {}) as RawWave;
  } catch {
    return null;
  }
  const verifications = Array.isArray(raw.verifications) ? raw.verifications : [];
  const passing = verifications.filter((v) => v.status === "pass").length;
  const na = verifications.filter((v) => v.status === "n-a").length;
  return {
    wave: raw.wave ?? fallbackName,
    status: raw.status ?? "unknown",
    total: verifications.length,
    passing,
    settled: passing + na,
  };
}

/** Load every wave an items list references. Missing files are simply absent. */
export async function loadWaves(
  root: string,
  dir: string,
  names: readonly string[]
): Promise<Record<string, WaveSummary>> {
  const out: Record<string, WaveSummary> = {};
  for (const name of new Set(names)) {
    const file = path.join(root, dir, `${name}.yaml`);
    try {
      const summary = summarizeWaveText(await fs.readFile(file, "utf8"), name);
      if (summary) out[name] = summary;
    } catch {
      // reported by validate V14; the rollup just goes without
    }
  }
  return out;
}
