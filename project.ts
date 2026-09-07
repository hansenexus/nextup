/**
 * Projections: one roadmap, two audiences.
 *
 * `toPublic` is a whitelist, not a blacklist. It names every field that may
 * leave the building; anything added to the schema later stays internal until
 * someone adds it here on purpose. `project.test.ts` walks the output and
 * fails on any key from the forbidden list, so the two lists cannot drift
 * apart silently.
 *
 * `toInternal` is everything, plus what the rollup learned.
 */

import type {
  InternalRoadmap,
  Item,
  ItemStatus,
  Lane,
  PublicItem,
  PublicMilestone,
  PublicPhase,
  PublicRoadmap,
  Roadmap,
  Rollup,
} from "./types";

/** Keys that must never appear anywhere in a public projection. */
export const FORBIDDEN_PUBLIC_KEYS = [
  "issues",
  "linked_issues",
  "tasks",
  "task_rollup",
  "owners",
  "notes",
  "description",
  "evidence",
  "lane",
  "lanes",
  "mechanics_wave",
  "mechanics_waves",
  "clients",
  "repo",
  "labels",
  "fleet_env",
  "scope",
  "orphans",
  "because",
  "warnings",
  "source",
  "by",
  "ref",
] as const;

export function isPubliclyVisible(item: Item, roadmap: Roadmap): boolean {
  if (item.visibility !== "public") return false;
  const phase = roadmap.phases.find((p) => p.id === item.phase);
  return phase?.visibility !== "internal";
}

export function toPublic(roadmap: Roadmap, roll: Rollup): PublicRoadmap {
  const visible = roadmap.items.filter((it) => isPubliclyVisible(it, roadmap));
  const visibleIds = new Set(visible.map((it) => it.id));
  const publicStatus = (s: ItemStatus): ItemStatus =>
    s === "blocked" ? roadmap.meta.presentation.show_blocked_as : s;

  const items: PublicItem[] = visible.map((it) => {
    const r = roll.items[it.id];
    const status = publicStatus(r?.status ?? it.status ?? "proposed");
    return {
      id: it.id,
      title: it.title,
      ...(it.summary ? { summary: it.summary } : {}),
      phase: it.phase,
      horizon: r?.horizon ?? "later",
      status,
      kind: it.kind,
      ...(it.area ? { area: it.area } : {}),
      depends_on: it.depends_on.filter((d) => visibleIds.has(d)),
      links: it.links,
      ...(it.since ? { since: it.since } : {}),
    };
  });

  const phases: PublicPhase[] = roadmap.phases
    .filter((p) => p.visibility !== "internal" && items.some((it) => it.phase === p.id))
    .map((p) => {
      const mine = items.filter((it) => it.phase === p.id && it.status !== "dropped");
      return {
        id: p.id,
        title: p.title,
        ...(p.goal ? { goal: p.goal } : {}),
        ...(p.gets_you ? { gets_you: p.gets_you } : {}),
        ...(p.target ? { target: p.target } : {}),
        horizon: roll.phases[p.id]?.horizon ?? "later",
        progress: { done: mine.filter((it) => it.status === "done").length, total: mine.length },
      };
    });
  const phaseIds = new Set(phases.map((p) => p.id));

  const milestones: PublicMilestone[] = roadmap.milestones
    .filter((m) => m.visibility === "public" && phaseIds.has(m.phase))
    .map((m) => ({
      id: m.id,
      title: m.title,
      ...(m.summary ? { summary: m.summary } : {}),
      phase: m.phase,
      status: m.status,
      date: m.status === "planned" || m.status === "reached" ? m.date : null,
      source_kind: m.source?.kind ?? null,
      reached_at: m.status === "reached" ? m.reached_at : null,
    }));

  return {
    schema: 1,
    audience: "public",
    project: roadmap.meta.project,
    title: roadmap.meta.title,
    locales: roadmap.meta.locales,
    version: roadmap.meta.version,
    updated: roadmap.meta.updated,
    generated_at: roll.generatedAt,
    stale: roll.stale,
    stale_reason: roll.staleReason,
    current_phase: roadmap.meta.current_phase,
    phases,
    items,
    milestones,
  };
}

export function toInternal(roadmap: Roadmap, roll: Rollup, file: string): InternalRoadmap {
  const laneFor = (n: number, lanes: readonly Lane[]) => lanes.find((l) => l.issue === n) ?? null;
  return {
    schema: 1,
    audience: "internal",
    file,
    meta: roadmap.meta,
    generated_at: roll.generatedAt,
    stale: roll.stale,
    stale_reason: roll.staleReason,
    phases: roadmap.phases.map((p) => ({
      ...p,
      ...(roll.phases[p.id] ?? {
        id: p.id,
        horizon: "later" as const,
        progress: { done: 0, total: 0 },
      }),
    })),
    items: roadmap.items.map((it) => {
      const r = roll.items[it.id];
      return {
        ...it,
        horizon: r?.horizon ?? "later",
        derived_status: r?.status ?? it.status ?? "proposed",
        because: r?.because ?? "",
        linked_issues: (r?.issues ?? []).map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          labels: i.labels,
          url: i.url,
          lane: laneFor(i.number, r?.lanes ?? []),
        })),
        task_rollup: r?.tasks ?? [],
        wave: r?.wave ?? null,
        warnings: r?.warnings ?? [],
      };
    }),
    milestones: roadmap.milestones,
    orphans: roll.orphans,
    warnings: roll.warnings,
  };
}

/** Walk any JSON value and report forbidden keys with their paths. */
export function findForbiddenKeys(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      hits.push(...findForbiddenKeys(v, `${path}[${i}]`));
    });
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((FORBIDDEN_PUBLIC_KEYS as readonly string[]).includes(k)) hits.push(`${path}.${k}`);
      hits.push(...findForbiddenKeys(v, `${path}.${k}`));
    }
  }
  return hits;
}
