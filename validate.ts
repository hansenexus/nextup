/**
 * Offline validation, rules V2–V14. V1 (shape) is the Zod parse in `load.ts`.
 *
 * Errors are things a build must not ship; warnings are things a reviewer
 * should see in the PR. The split is the point: a public item without a
 * summary is an error because the public page would render an empty card,
 * while a dependency pointing into a later phase is a warning because the
 * author may know something the ordering does not.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { topoSort } from "./graph";
import { missingLocale, resolveText } from "./i18n";
import { taskKey } from "./markers";
import type { Finding, Roadmap, ValidationResult } from "./types";

/** Text that would leak internals if it reached a public page. */
export const LEAK_RE = /(^|\s)#\d+\b|(^|\s)@[a-z0-9-]{2,}\b|\bstatus[:/]/i;

export interface ValidateOptions {
  /** Repo root, for `mechanics_waves` file checks. Omit to skip filesystem rules. */
  root?: string;
  /** "Now" for the future-date rule; injectable for tests. */
  today?: string;
}

export async function validateRoadmap(
  roadmap: Roadmap,
  options: ValidateOptions = {}
): Promise<ValidationResult> {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const err = (rule: string, p: string, message: string) => errors.push({ rule, path: p, message });
  const warn = (rule: string, p: string, message: string) =>
    warnings.push({ rule, path: p, message });
  const pendingWaveChecks: Array<{ path: string; file: string; wave: string }> = [];

  const phaseIds = roadmap.phases.map((p) => p.id);
  const phaseIndex = new Map(phaseIds.map((id, i) => [id, i]));
  const fallback = roadmap.meta.locales[0] ?? "en";

  // V2 — every phase reference resolves
  if (!phaseIndex.has(roadmap.meta.current_phase)) {
    err("V2", "meta.current_phase", `unknown phase "${roadmap.meta.current_phase}"`);
  }
  roadmap.items.forEach((item, i) => {
    if (!phaseIndex.has(item.phase))
      err("V2", `items[${i}].phase`, `unknown phase "${item.phase}"`);
  });
  roadmap.milestones.forEach((m, i) => {
    if (!phaseIndex.has(m.phase)) err("V2", `milestones[${i}].phase`, `unknown phase "${m.phase}"`);
  });

  // V3 — ids unique (items + aliases share one namespace; phases; milestones; tasks per item)
  const seenPhase = new Set<string>();
  roadmap.phases.forEach((p, i) => {
    if (seenPhase.has(p.id)) err("V3", `phases[${i}].id`, `duplicate phase id "${p.id}"`);
    seenPhase.add(p.id);
  });
  const seenItem = new Map<string, string>();
  roadmap.items.forEach((item, i) => {
    for (const id of [item.id, ...item.aliases]) {
      const where = seenItem.get(id);
      if (where) err("V3", `items[${i}]`, `id or alias "${id}" already used at ${where}`);
      else seenItem.set(id, `items[${i}]`);
    }
    const seenTask = new Set<string>();
    item.tasks.forEach((t, j) => {
      if (seenTask.has(t.id))
        err("V3", `items[${i}].tasks[${j}].id`, `duplicate task id "${t.id}"`);
      seenTask.add(t.id);
    });
  });
  const seenMilestone = new Set<string>();
  roadmap.milestones.forEach((m, i) => {
    if (seenMilestone.has(m.id))
      err("V3", `milestones[${i}].id`, `duplicate milestone id "${m.id}"`);
    seenMilestone.add(m.id);
  });

  // V4 — references resolve, graphs acyclic
  const itemIds = roadmap.items.map((it) => it.id);
  const canonical = (ref: string) =>
    seenItem.has(ref)
      ? (roadmap.items.find((it) => it.id === ref || it.aliases.includes(ref))?.id ?? ref)
      : ref;
  roadmap.items.forEach((item, i) => {
    item.depends_on.forEach((dep, j) => {
      if (!seenItem.has(dep)) err("V4", `items[${i}].depends_on[${j}]`, `unknown item "${dep}"`);
      else if (canonical(dep) === item.id)
        err("V4", `items[${i}].depends_on[${j}]`, "an item cannot depend on itself");
    });
  });
  const itemTopo = topoSort(itemIds, (id) => {
    const item = roadmap.items.find((it) => it.id === id);
    return (item?.depends_on ?? []).map(canonical);
  });
  if (itemTopo.cycle.length > 0) {
    err("V4", "items", `depends_on cycle among: ${itemTopo.cycle.join(", ")}`);
  }
  const allTaskKeys = new Set<string>();
  for (const item of roadmap.items)
    for (const t of item.tasks) allTaskKeys.add(taskKey(item.id, t.id));
  const taskEdges = (key: string): string[] => {
    const [itemId, taskId] = key.split("/");
    const item = roadmap.items.find((it) => it.id === itemId);
    const task = item?.tasks.find((t) => t.id === taskId);
    if (!item || !task) return [];
    return task.blocked_by.map((b) => (b.includes("/") ? b : taskKey(item.id, b)));
  };
  roadmap.items.forEach((item, i) => {
    item.tasks.forEach((t, j) => {
      t.blocked_by.forEach((b, k) => {
        const key = b.includes("/") ? b : taskKey(item.id, b);
        if (!allTaskKeys.has(key))
          err("V4", `items[${i}].tasks[${j}].blocked_by[${k}]`, `unknown task "${b}"`);
      });
    });
  });
  const taskTopo = topoSort([...allTaskKeys], taskEdges);
  if (taskTopo.cycle.length > 0)
    err("V4", "items[].tasks", `blocked_by cycle among: ${taskTopo.cycle.join(", ")}`);

  // V5 — depending on something scheduled LATER contradicts the phase order
  roadmap.items.forEach((item, i) => {
    const mine = phaseIndex.get(item.phase);
    for (const dep of item.depends_on) {
      const target = roadmap.items.find((it) => it.id === canonical(dep));
      const theirs = target ? phaseIndex.get(target.phase) : undefined;
      if (mine !== undefined && theirs !== undefined && theirs > mine) {
        warn(
          "V5",
          `items[${i}].depends_on`,
          `"${item.id}" (${item.phase}) depends on "${dep}" scheduled later (${target?.phase})`
        );
      }
    }
  });

  // V6 — milestone dates need provenance; states need their evidence
  roadmap.milestones.forEach((m, i) => {
    const p = `milestones[${i}]`;
    if (m.date && !m.source)
      err("V6", `${p}.source`, "a dated milestone needs a `source` (who committed to it, when)");
    if (m.date && m.status === "draft")
      err(
        "V6",
        `${p}.status`,
        "a draft milestone cannot carry a date — promote it to planned with a source, or drop the date"
      );
    if ((m.status === "planned" || m.status === "reached") && !m.date)
      err("V6", `${p}.date`, `status ${m.status} requires a date`);
    if (m.status === "reached" && !m.reached_at)
      err("V6", `${p}.reached_at`, "status reached requires reached_at");
    if (m.status === "dropped" && !m.reason)
      err("V6", `${p}.reason`, "status dropped requires a reason");
    m.items.forEach((ref, j) => {
      if (!seenItem.has(ref)) err("V4", `${p}.items[${j}]`, `unknown item "${ref}"`);
    });
  });

  // V7 — public items are public-safe
  const phaseVisibility = new Map(roadmap.phases.map((p) => [p.id, p.visibility]));
  roadmap.items.forEach((item, i) => {
    const p = `items[${i}]`;
    const effectivelyPublic =
      item.visibility === "public" && phaseVisibility.get(item.phase) !== "internal";
    if (!effectivelyPublic) return;
    if (!item.summary) err("V7", `${p}.summary`, "a public item needs a summary");
    for (const [field, value] of [
      ["title", item.title],
      ["summary", item.summary],
    ] as const) {
      if (!value) continue;
      const texts = typeof value === "string" ? [value] : Object.values(value);
      for (const text of texts) {
        if (LEAK_RE.test(text))
          warn("V7", `${p}.${field}`, `looks like it leaks internals: "${text}"`);
      }
    }
    // V8 — every declared locale has text
    for (const locale of roadmap.meta.locales) {
      if (missingLocale(item.title, locale))
        warn("V8", `${p}.title`, `no ${locale} text; will fall back to ${fallback}`);
      if (item.summary && missingLocale(item.summary, locale))
        warn("V8", `${p}.summary`, `no ${locale} text; will fall back to ${fallback}`);
    }
    if (item.visibility === "public" && phaseVisibility.get(item.phase) === "internal") {
      warn("V7", `${p}.visibility`, `public item in internal phase "${item.phase}" stays hidden`);
    }
  });

  // V9 — manual status only where nothing is linked
  roadmap.items.forEach((item, i) => {
    const p = `items[${i}]`;
    if (item.status && item.issues.length > 0 && item.status !== "dropped") {
      err(
        "V9",
        `${p}.status`,
        "manual status on an item with linked issues — status is derived once anything is linked"
      );
    }
    if (item.status && !item.since) err("V9", `${p}.since`, "a manual status needs `since`");
    if (item.since && !item.status)
      warn("V9", `${p}.since`, "`since` without a manual status does nothing");
    if (item.status === "dropped" && !item.reason)
      err("V9", `${p}.reason`, "status dropped requires a reason");
  });

  // V10 — the client tier does not exist yet
  roadmap.items.forEach((item, i) => {
    if (item.clients.length > 0)
      err(
        "V10",
        `items[${i}].clients`,
        "reserved for the client-portal tier; must be empty in schema 1"
      );
  });

  // V11 — dispatchable tasks carry acceptance + verification (schema enforces min 1; guard empty strings)
  roadmap.items.forEach((item, i) => {
    item.tasks.forEach((t, j) => {
      if (t.acceptance.every((a) => a.trim() === ""))
        err("V11", `items[${i}].tasks[${j}].acceptance`, "acceptance criteria are empty");
      if (t.verify.every((v) => v.trim() === ""))
        err("V11", `items[${i}].tasks[${j}].verify`, "verification commands are empty");
    });
  });

  // V12 — updated not in the future
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (roadmap.meta.updated > today)
    err("V12", "meta.updated", `${roadmap.meta.updated} is in the future (today ${today})`);
  roadmap.milestones.forEach((m, i) => {
    if (m.reached_at && m.reached_at > today)
      err("V12", `milestones[${i}].reached_at`, `${m.reached_at} is in the future`);
  });

  // V13 — a phase with nothing in it
  for (const phase of roadmap.phases) {
    const count = roadmap.items.filter((it) => it.phase === phase.id).length;
    if (count === 0)
      warn("V13", `phases[${phaseIds.indexOf(phase.id)}]`, `phase "${phase.id}" has no items`);
  }

  // V14 — mechanics wave references
  roadmap.items.forEach((item, i) => {
    if (!item.mechanics_wave) return;
    if (!roadmap.meta.mechanics_waves) {
      err("V14", `items[${i}].mechanics_wave`, "meta.mechanics_waves is not set");
      return;
    }
    if (options.root) {
      const file = path.join(
        options.root,
        roadmap.meta.mechanics_waves,
        `${item.mechanics_wave}.yaml`
      );
      // checked below, asynchronously
      pendingWaveChecks.push({
        path: `items[${i}].mechanics_wave`,
        file,
        wave: item.mechanics_wave,
      });
    }
  });
  for (const check of pendingWaveChecks) {
    try {
      await fs.access(check.file);
    } catch {
      err(
        "V14",
        check.path,
        `wave file not found: ${path.relative(options.root ?? "", check.file)}`
      );
    }
  }

  // Title sanity for the fallback locale — a roadmap that cannot render its own name is broken.
  if (resolveText(roadmap.meta.title, fallback).trim() === "")
    err("V1", "meta.title", "empty title");

  return { errors, warnings };
}

export function formatFindings(result: ValidationResult, file: string): string {
  const lines: string[] = [];
  for (const f of result.errors) lines.push(`${file}: error ${f.rule} ${f.path}: ${f.message}`);
  for (const f of result.warnings) lines.push(`${file}: warning ${f.rule} ${f.path}: ${f.message}`);
  return lines.join("\n");
}
